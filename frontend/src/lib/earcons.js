/**
 * Señales sonoras breves (earcons).
 *
 * Se usan donde la voz sintética no sirve: durante la grabación, porque cualquier
 * locución larga entraría en el micrófono, y como canal alternativo del factor háptico
 * cuando el dispositivo no vibra.
 *
 * Sobre la elección del timbre: una primera versión usaba senoidales a 440 Hz con poca
 * ganancia y resultaba casi inaudible en un teléfono. Los altavoces chicos son muy
 * ineficientes por debajo de ~800 Hz, y una senoidal es, a igual amplitud, la forma de
 * onda que menos se percibe porque concentra toda su energía en un único armónico. Ahora
 * los tonos están cerca de 1 kHz —donde coinciden la eficiencia del parlante y la máxima
 * sensibilidad del oído— y usan ondas ricas en armónicos.
 */

let context = null
let master = null

/** Debe llamarse desde un gesto del usuario: los navegadores móviles nacen con el audio bloqueado. */
export function unlockAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return

  if (!context) {
    context = new AudioContextClass()
    master = context.createGain()
    master.gain.value = 1
    master.connect(context.destination)
  }

  if (context.state !== 'running') context.resume()

  // Desbloqueo canónico de iOS: reproducir un buffer mudo dentro del propio gesto. Sin
  // esto, Safari deja el contexto en un estado en el que programa sonidos que nunca salen.
  try {
    const buffer = context.createBuffer(1, 1, 22050)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(master)
    source.start(0)
  } catch {
    /* el desbloqueo es una mejora, no un requisito */
  }
}

/** Estado real del audio, para poder informarlo en vez de fallar callados. */
export function audioState() {
  return context ? context.state : 'sin-contexto'
}

function tone({ frequency, duration, volume, startAt = 0, type = 'square' }) {
  if (!context) return false

  // Si quedó suspendido —iOS lo hace al volver de una interrupción— pedimos reanudar y
  // programamos igual: antes se descartaba el tono en silencio y no había forma de saberlo.
  if (context.state !== 'running') context.resume()

  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.type = type
  oscillator.frequency.value = frequency

  const begin = context.currentTime + startAt
  const end = begin + duration

  // Rampas cortas de entrada y salida: un tono que arranca y corta en seco produce un
  // chasquido de banda ancha, justo lo que no queremos dentro de la grabación.
  gain.gain.setValueAtTime(0.0001, begin)
  gain.gain.exponentialRampToValueAtTime(volume, begin + 0.012)
  gain.gain.setValueAtTime(volume, end - 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, end)

  oscillator.connect(gain).connect(master ?? context.destination)
  oscillator.start(begin)
  oscillator.stop(end + 0.02)
  return true
}

/** Se alcanzó el mínimo de voz: ya se puede soltar. Suena dentro de la grabación. */
export function earconMinimumReached() {
  // Más contenido que antes, pero corto: entra en la muestra de voz y no queremos
  // perturbar el embedding más de lo imprescindible.
  tone({ frequency: 1050, duration: 0.16, volume: 0.32, type: 'triangle' })
}

/** Factor verificado. Suena fuera de la grabación, así que puede ser franco. */
export function earconSuccess() {
  tone({ frequency: 780, duration: 0.13, volume: 0.5, type: 'triangle' })
  tone({ frequency: 1170, duration: 0.22, volume: 0.5, type: 'triangle', startAt: 0.13 })
}

/** Verificación rechazada. */
export function earconFailure() {
  tone({ frequency: 420, duration: 0.2, volume: 0.5, type: 'square' })
  tone({ frequency: 280, duration: 0.32, volume: 0.5, type: 'square', startAt: 0.2 })
}

/**
 * Reproduce un patrón vibrotáctil como ritmo sonoro.
 *
 * Existe porque iOS Safari no implementa la Vibration API: sin esta alternativa, el factor
 * háptico sería inusable en iPhone. Respeta el mismo ritmo que la vibración, de modo que
 * el usuario cuenta lo mismo sirva el canal que sirva.
 *
 * Va deliberadamente fuerte: es el canal principal cuando no hay vibración, y contar mal
 * por no oír bien es un fallo de autenticación.
 *
 * Advertencia de seguridad: por audio el patrón es audible para quien esté cerca, lo que
 * anula la resistencia a la observación que da la vibración. Por eso conviene auriculares.
 *
 * @param {number[]} pattern milisegundos alternando sonido y silencio, como navigator.vibrate
 */
export function playPatternAsTones(pattern) {
  let offset = 0
  pattern.forEach((duration, index) => {
    const seconds = duration / 1000
    if (index % 2 === 0) {
      tone({ frequency: 950, duration: seconds, volume: 0.65, type: 'square', startAt: offset })
    }
    offset += seconds
  })
}

/** Tono de prueba para la calibración del canal sonoro. */
export function earconAudioProbe() {
  tone({ frequency: 950, duration: 0.25, volume: 0.65, type: 'square' })
  tone({ frequency: 950, duration: 0.25, volume: 0.65, type: 'square', startAt: 0.45 })
}
