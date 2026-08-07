/**
 * Retroalimentación háptica con significado semántico.
 *
 * Cada patrón es distinguible del resto por duración y cadencia, de modo que el
 * usuario pueda reconocer el estado del sistema sin audio ni pantalla. La Vibration
 * API no está disponible en iOS Safari; el flujo nunca depende sólo de este canal.
 */

export const PATTERN = {
  stepStart: 30,
  strokeStart: 20,
  strokeEnd: 45,
  captureStart: [30, 40, 30],
  captureStop: 60,
  factorPassed: [40, 70, 40],
  success: [60, 80, 60, 80, 160],
  failure: [180, 90, 180],
  warning: [15, 60, 15, 60, 15],
}

const SUPPORTED = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

let enabled = true

export const hapticsSupported = SUPPORTED

export function setHapticsEnabled(value) {
  enabled = value
  if (!value && SUPPORTED) navigator.vibrate(0)
}

/**
 * @returns {boolean} si el navegador aceptó el pedido.
 *
 * Ojo con qué significa `true`: que la petición fue aceptada, no que el motor se haya
 * movido. En un equipo de escritorio devuelve `true` y no pasa nada. Por eso saber si el
 * usuario realmente siente algo requiere preguntárselo, no deducirlo.
 */
export function vibrate(pattern) {
  if (!SUPPORTED || !enabled || !pattern) return false
  try {
    return navigator.vibrate(pattern) !== false
  } catch {
    // Algunos navegadores exigen un gesto de usuario previo; no es un fallo recuperable.
    return false
  }
}
