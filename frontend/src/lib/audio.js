/**
 * Captura de voz para verificación biométrica.
 *
 * El backend hace `librosa.load(..., sr=16000, mono=True)` y luego exige al menos
 * 5 segundos de voz *activa* tras remover silencios. Por eso acá:
 *  - remuestreamos a 16 kHz mono antes de subir (mismo material que analiza el modelo,
 *    y un archivo mucho más chico),
 *  - exponemos el nivel real del micrófono para poder avisar si nadie está hablando.
 */

const TARGET_SAMPLE_RATE = 16000

/**
 * El backend NO exige N segundos de grabación: exige 5 s de voz **activa**, medidos
 * después de descartar los silencios con `librosa.effects.split(top_db=25)`. Un tiempo de
 * reloj de pared es un mal sustituto — quien habla de corrido llega en 5,5 s, y quien
 * hace pausas puede sostener 8 s y quedarse corto igual.
 *
 * Así que medimos lo mismo que mide el backend, y le dejamos un margen: nuestra detección
 * es una aproximación en vivo y no puede conocer el pico global del audio hasta el final.
 */
export const BACKEND_MIN_VOICED_MS = 5000
export const MIN_VOICED_MS = 5800

/** Umbral de `librosa.effects.split(top_db=25)`: -25 dB respecto del pico. */
const VOICED_RATIO = 10 ** (-25 / 20)

/**
 * Piso absoluto de RMS. Sin él, en una sala en silencio el pico también es minúsculo y
 * la comparación relativa daría "voz" para el propio ruido de fondo.
 */
const VOICED_FLOOR = 0.01

/** Cada cuánto se muestrea el micrófono. 50 ms alcanza para el nivel visual y para la VAD. */
const METER_INTERVAL_MS = 50

function assertSecureContext() {
  const isSecure = window.isSecureContext || window.location.protocol === 'https:'
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

  if (!isSecure && !isLocalhost) {
    throw new Error(
      'El micrófono requiere una conexión segura. Abrí la aplicación en localhost o por HTTPS.',
    )
  }
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type))
}

/** Codifica un AudioBuffer mono a WAV PCM 16 bits. */
function encodeWav(audioBuffer) {
  const samples = audioBuffer.getChannelData(0)
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }

  const byteRate = audioBuffer.sampleRate * 2

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // tamaño del bloque fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, audioBuffer.sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits por muestra
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }

  return buffer
}

/** Mezcla a mono y remuestrea a 16 kHz. Si el navegador no lo permite, devuelve el original. */
async function toMono16k(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1 && audioBuffer.sampleRate === TARGET_SAMPLE_RATE) {
    return audioBuffer
  }

  const frames = Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE)
  if (frames <= 0) return audioBuffer

  try {
    const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = audioBuffer
    source.connect(offline.destination)
    source.start()
    return await offline.startRendering()
  } catch {
    // Safari antiguo rechaza sample rates bajos en OfflineAudioContext.
    return audioBuffer
  }
}

async function blobToWav(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return blob

  const context = new AudioContextClass()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const normalized = await toMono16k(decoded)
    return new Blob([encodeWav(normalized)], { type: 'audio/wav' })
  } catch (error) {
    console.warn('No se pudo convertir el audio a WAV, se envía el original.', error)
    return blob
  } finally {
    context.close()
  }
}

export class VoiceRecorder {
  /** @param {{onMeter?: (reading: {level: number, voicedMs: number}) => void}} [handlers] */
  constructor({ onMeter } = {}) {
    this.onMeter = onMeter
    this.stream = null
    this.recorder = null
    this.chunks = []
    this.audioContext = null
    this.analyser = null
    this.meterId = null
    this.startedAt = 0
    /** Milisegundos de voz activa acumulados, con el criterio del backend. */
    this.voicedAccumMs = 0
    /** El medidor puede no arrancar (AudioContext suspendido, navegador sin AnalyserNode). */
    this.meterRunning = false
  }

  /**
   * Voz activa detectada.
   *
   * Si el medidor no llegó a funcionar, degradamos a tiempo de reloj. Es una estimación
   * peor —cuenta los silencios como si fueran voz— pero el modo de fallo alternativo es
   * mucho más grave: un contador clavado en cero que impide alcanzar el mínimo, dejando
   * al usuario sosteniendo el dedo para siempre sin explicación.
   */
  get voicedMs() {
    if (this.meterRunning) return this.voicedAccumMs
    return this.startedAt ? performance.now() - this.startedAt : 0
  }

  get isRecording() {
    return this.recorder?.state === 'recording'
  }

  async start() {
    assertSecureContext()

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite acceder al micrófono.')
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })

    const mimeType = pickMimeType()
    this.recorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType })
      : new MediaRecorder(this.stream)

    this.chunks = []
    this.recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) this.chunks.push(event.data)
    }
    this.recorder.start()
    this.startedAt = performance.now()

    this.#startLevelMeter()
  }

  /** Detiene la captura y resuelve con el WAV listo para subir. */
  stop() {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        reject(new Error('No hay una grabación en curso.'))
        return
      }

      this.recorder.onstop = async () => {
        this.#teardown()
        try {
          const raw = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' })
          resolve(await blobToWav(raw))
        } catch (error) {
          reject(error)
        }
      }
      this.recorder.stop()
    })
  }

  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.#teardown()
  }

  #startLevelMeter() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return

    this.audioContext = new AudioContextClass()
    // Si el contexto nace suspendido, el analizador entrega ceros y la detección de voz
    // se queda clavada. Pedir resume() no siempre alcanza, de ahí el respaldo del getter.
    this.audioContext.resume?.()

    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 1024
    this.audioContext.createMediaStreamSource(this.stream).connect(this.analyser)

    const samples = new Float32Array(this.analyser.fftSize)
    let peak = 0
    let lastTimestamp = performance.now()

    const tick = () => {
      const now = performance.now()
      const delta = now - lastTimestamp
      lastTimestamp = now

      // Sólo consideramos el medidor operativo cuando el contexto realmente corre.
      if (this.audioContext?.state === 'running') this.meterRunning = true

      this.analyser.getFloatTimeDomainData(samples)

      let sumOfSquares = 0
      for (let i = 0; i < samples.length; i += 1) sumOfSquares += samples[i] * samples[i]
      const rms = Math.sqrt(sumOfSquares / samples.length)

      peak = Math.max(peak, rms)

      // Mismo criterio que el backend: por encima de -25 dB respecto del pico. Acá el pico
      // es el observado hasta ahora, no el de todo el audio, así que la cuenta es algo
      // generosa al principio; el margen de MIN_VOICED_MS lo compensa.
      if (rms > VOICED_FLOOR && rms > peak * VOICED_RATIO) {
        this.voicedAccumMs += delta
      }

      // Escala perceptual: el habla normal ronda un RMS de 0.05–0.2.
      this.onMeter?.({ level: Math.min(1, rms * 4), voicedMs: this.voicedMs })
    }

    // Con temporizador, no con requestAnimationFrame: rAF está atado al ciclo de dibujo y
    // se detiene si la página deja de renderizarse — una notificación encima, la pantalla
    // que se atenúa. Medir voz no puede depender de que haya algo que dibujar.
    this.meterId = setInterval(tick, METER_INTERVAL_MS)
    tick()
  }

  #teardown() {
    if (this.meterId) clearInterval(this.meterId)
    this.meterId = null

    this.audioContext?.close()
    this.audioContext = null
    this.analyser = null

    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null

    this.onMeter?.({ level: 0, voicedMs: this.voicedMs })
  }
}
