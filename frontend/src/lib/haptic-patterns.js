import { playPatternAsTones } from './earcons'
import { vibrate } from './haptics'

/**
 * Alfabeto del factor háptico: **cantidades de pulsos**, no formas de onda.
 *
 * Una primera versión usaba patrones tipo "corto / largo / doble" y resultó inservible.
 * Distinguir formas exige del motor de vibración una fidelidad que casi ningún teléfono
 * tiene, y del usuario una discriminación fina sin ninguna referencia contra la cual
 * calibrar: es una tarea que no se puede hacer, no una que se haga mal.
 *
 * Contar pulsos separados funciona en cualquier hardware y no hay nada que aprender: el
 * símbolo *es* el número. El secreto pasa a ser una secuencia de números.
 */
export const HAPTIC_SYMBOLS = ['1', '2', '3']

const PULSE_MS = 160
const GAP_MS = 200

/** @param {string|number} symbol cantidad de pulsos */
export function patternForSymbol(symbol) {
  const count = Number(symbol)
  const pattern = []
  for (let i = 0; i < count; i += 1) {
    pattern.push(PULSE_MS)
    if (i < count - 1) pattern.push(GAP_MS)
  }
  return pattern
}

export function patternDuration(symbol) {
  return patternForSymbol(symbol).reduce((total, ms) => total + ms, 0)
}

const STORAGE_KEY = 'poc-auth-haptic-channel'
const CONFIRMED_KEY = 'poc-auth-haptic-audio-ok'

/**
 * Canal por el que se emiten los símbolos: 'vibration' o 'audio'.
 *
 * No se puede deducir. `navigator.vibrate` devuelve `true` cuando el navegador acepta el
 * pedido, no cuando el motor se mueve — en una laptop devuelve `true` y no pasa nada. La
 * única fuente de verdad es el usuario, así que se le pregunta una vez y se recuerda.
 */
export function getChannel() {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setChannel(channel) {
  try {
    window.localStorage.setItem(STORAGE_KEY, channel)
  } catch {
    /* sin almacenamiento: se vuelve a preguntar la próxima vez */
  }
}

/** Emite un símbolo por el canal elegido. */
export function playSymbol(symbol, channel) {
  const pattern = patternForSymbol(symbol)
  if (!pattern.length) return

  if (channel === 'vibration') vibrate(pattern)
  else playPatternAsTones(pattern)
}

/**
 * Recuerda que el usuario ya confirmó escuchar los tonos.
 *
 * Sin esto, la prueba de sonido se repetiría en cada autenticación. Para alguien que no ve
 * la pantalla, escuchar la misma calibración de medio minuto en cada ingreso convierte una
 * ayuda en un peaje.
 */
export function isAudioConfirmed() {
  try {
    return window.localStorage.getItem(CONFIRMED_KEY) === 'si'
  } catch {
    return false
  }
}

export function setAudioConfirmed() {
  try {
    window.localStorage.setItem(CONFIRMED_KEY, 'si')
  } catch {
    /* sin almacenamiento: se vuelve a preguntar */
  }
}

/** Prueba de vibración para la calibración inicial. */
export function probeVibration() {
  return vibrate([200, 150, 200])
}
