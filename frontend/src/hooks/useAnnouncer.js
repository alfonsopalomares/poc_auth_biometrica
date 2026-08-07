import { useCallback, useRef, useState } from 'react'
import { speak } from '../lib/speech'

const MAX_EVENTS = 12

let nextId = 0

/**
 * Único punto de salida para todo lo que el sistema le comunica al usuario.
 *
 * Emite por tres canales a la vez:
 *  - región aria-live (para el lector de pantalla que el usuario ya usa),
 *  - síntesis de voz propia (para quien no tiene lector de pantalla),
 *  - historial visible en pantalla (para usuarios con visión y como evidencia de la PoC).
 *
 * `assertive` se reserva para errores y para el resultado final. El progreso normal va
 * en `polite` para no interrumpir al lector de pantalla en mitad de una frase.
 */
export function useAnnouncer() {
  const [polite, setPolite] = useState(null)
  const [assertive, setAssertive] = useState(null)
  const [events, setEvents] = useState([])

  // Mientras el micrófono está abierto no se emite NADA: ni voz sintética propia ni
  // actualizaciones de aria-live. Lo segundo importa tanto como lo primero, porque el
  // lector de pantalla del usuario leería ese cambio en voz alta y quedaría grabado.
  const mutedRef = useRef(false)
  const setMuted = useCallback((value) => {
    mutedRef.current = value
  }, [])

  // A propósito no se deduplican mensajes repetidos: si el usuario reintenta y vuelve a
  // fallar igual, tiene que volver a escuchar el motivo. Quien evita anuncios espurios
  // es cada efecto que llama acá, no este hook.
  const emit = useCallback((text, { assertive: isAssertive = false, spoken = true, onEnd } = {}) => {
    if (!text || mutedRef.current) {
      onEnd?.()
      return
    }

    const entry = {
      id: (nextId += 1),
      text,
      politeness: isAssertive ? 'assertive' : 'polite',
      time: new Date().toLocaleTimeString('es-AR'),
    }

    if (isAssertive) setAssertive(entry)
    else setPolite(entry)

    setEvents((prev) => [entry, ...prev].slice(0, MAX_EVENTS))
    if (spoken) speak(text, { interrupt: isAssertive, onEnd })
    else onEnd?.()
  }, [])

  const announce = useCallback((text, options) => emit(text, options), [emit])

  /**
   * Anuncia y espera a que la locución termine de verdad.
   *
   * Reemplaza a las esperas fijas del tipo "hablo y aguardo cuatro segundos". Esa
   * estimación es imposible de acertar —depende de la voz, la velocidad y el largo del
   * texto— y cuando se queda corta el sistema empieza a emitir señales mientras todavía
   * está hablando, que es justo cuando el usuario no puede prestarles atención.
   */
  const announceAndWait = useCallback(
    (text, options = {}) =>
      new Promise((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }

        emit(text, { ...options, onEnd: finish })

        // Red de seguridad: en varios navegadores `onend` no llega si la locución se
        // cancela o se interrumpe. Sin esto, el recorrido quedaría esperando para siempre.
        const words = String(text).trim().split(/\s+/).length
        setTimeout(finish, Math.min(30000, words * 450 + 2500))
      }),
    [emit],
  )

  const resetAnnouncements = useCallback(() => {
    setPolite(null)
    setAssertive(null)
  }, [])

  return { polite, assertive, events, announce, announceAndWait, resetAnnouncements, setMuted }
}
