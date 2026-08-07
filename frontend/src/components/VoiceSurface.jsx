import { useEffect, useRef } from 'react'
import { useHoldToRecord } from '../hooks/useHoldToRecord'
import { MIN_VOICED_MS } from '../lib/audio'

const MIN_SECONDS = Math.round(MIN_VOICED_MS / 1000)

// La consigna no promete una duración fija de grabación: lo que se mide es cuánto se
// habló, no cuánto se sostuvo el dedo. Prometer "7 segundos" sería mentir a quien hace
// pausas, que necesita más, y castigar a quien habla de corrido, que necesita menos.
export const VOICE_PROMPT =
  'Verificación por voz. ' +
  'Pulsá en cualquier parte de la pantalla y mantené apretado para grabar. ' +
  `Hablá sin pausas largas: hacen falta unos ${MIN_SECONDS} segundos de voz. ` +
  'Escucharás una señal sonora cuando sea suficiente, y ahí podés soltar.'

/**
 * Toda la pantalla graba mientras el dedo está apoyado.
 *
 * No hay un botón que encontrar: la superficie ocupa el viewport completo, así que el
 * usuario puede pulsar donde le quede la mano. Esa es la corrección de fondo al flujo
 * anterior, que exigía localizar un control para empezar y otro para terminar.
 */
export default function VoiceSurface({ onCapture, announce, setMuted, busy }) {
  const promptedRef = useRef(false)
  const { phase, voicedMs, level, error, minimumReached, press, release } = useHoldToRecord({
    onCapture,
    announce,
    setMuted,
  })

  useEffect(() => {
    if (promptedRef.current) return
    promptedRef.current = true
    announce(VOICE_PROMPT)
  }, [announce])

  const seconds = Math.floor(voicedMs / 1000)
  const recording = phase === 'recording'

  const readout = () => {
    if (phase === 'processing' || busy) return 'Procesando tu voz…'
    if (phase === 'opening') return 'Abriendo el micrófono…'
    if (recording) {
      return minimumReached
        ? `Voz captada: ${seconds} s. Ya podés soltar.`
        : `Voz captada: ${seconds} s de ${MIN_SECONDS}. Seguí hablando.`
    }
    return 'Pulsá y mantené apretado para grabar.'
  }

  return (
    <div
      className={`surface surface--voice ${recording ? 'is-recording' : ''}`}
      role="application"
      aria-label="Grabación de voz: pulsá y mantené apretado en cualquier parte de la pantalla"
      onPointerDown={(event) => {
        event.preventDefault()
        // La captura de puntero mantiene vivo el evento aunque el dedo se deslice fuera
        // del elemento, pero es una mejora: si el navegador la rechaza, la grabación
        // tiene que arrancar igual.
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId)
        } catch {
          /* seguimos sin captura */
        }
        press()
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* El anillo late con el nivel real del micrófono: es información para quien
          acompaña la demo, nunca la única vía para el usuario. */}
      <span
        className="pulse"
        aria-hidden="true"
        style={{ transform: `scale(${recording ? 1 + level * 0.6 : 1})` }}
      />

      <span className="surface__title">Verificación por voz</span>
      <span className="surface__hint">{readout()}</span>

      {recording ? (
        <span className="surface__counter" aria-hidden="true">
          {seconds}s
        </span>
      ) : null}

      {error ? <span className="surface__error">{error}</span> : null}
    </div>
  )
}
