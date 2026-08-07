/**
 * Síntesis de voz para el flujo de autenticación.
 *
 * Es un canal de salida de primera clase, no un extra: el flujo completo tiene que
 * poder recorrerse sin mirar la pantalla. Convive con las regiones aria-live, que
 * son las que atienden a quien ya usa un lector de pantalla propio.
 */

const SUPPORTED = typeof window !== 'undefined' && 'speechSynthesis' in window

let enabled = true
let suppressed = false
let preferredVoice = null

function pickVoice() {
  if (!SUPPORTED) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  // Preferimos español rioplatense, después cualquier español, después lo que haya.
  return (
    voices.find((v) => v.lang === 'es-AR') ??
    voices.find((v) => v.lang?.startsWith('es')) ??
    null
  )
}

if (SUPPORTED) {
  preferredVoice = pickVoice()
  // La lista de voces se puebla de forma asíncrona en Chrome y Safari.
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    preferredVoice = pickVoice()
  })
}

export const speechSupported = SUPPORTED

export function setSpeechEnabled(value) {
  enabled = value
  if (!value) cancelSpeech()
}

/**
 * Silencio forzado mientras el micrófono está abierto.
 *
 * Sin esto, la síntesis de voz entra en la grabación y se mezcla con la voz del usuario:
 * el embedding termina describiendo a dos locutores. Es una regla dura, separada de la
 * preferencia del usuario, porque acá no se trata de comodidad sino de no corromper la
 * muestra biométrica.
 */
export function setSpeechSuppressed(value) {
  suppressed = value
  if (value) cancelSpeech()
}

export function cancelSpeech() {
  if (SUPPORTED) window.speechSynthesis.cancel()
}

/**
 * @param {string} text
 * @param {{interrupt?: boolean, rate?: number}} [options]
 *   interrupt: corta lo que se esté diciendo. Se usa para errores y cambios de paso,
 *   donde escuchar el mensaje anterior hasta el final sería una pérdida de tiempo.
 */
export function speak(text, { interrupt = false, rate = 1, onEnd } = {}) {
  if (!SUPPORTED || !enabled || suppressed || !text) {
    onEnd?.()
    return
  }

  if (interrupt) window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = preferredVoice?.lang ?? 'es-ES'
  if (preferredVoice) utterance.voice = preferredVoice
  utterance.rate = rate
  utterance.pitch = 1
  utterance.volume = 1
  if (onEnd) {
    utterance.onend = onEnd
    utterance.onerror = onEnd
  }
  window.speechSynthesis.speak(utterance)
}

/**
 * iOS y Android exigen que la primera locución nazca de un gesto del usuario. Se llama
 * desde el toque que abre la demo; sin esto, todos los anuncios posteriores se descartan
 * en silencio y el usuario no vidente se queda sin ninguna guía.
 */
export function unlockSpeech() {
  if (!SUPPORTED) return
  const primer = new SpeechSynthesisUtterance('')
  primer.volume = 0
  window.speechSynthesis.speak(primer)
}
