import { useEffect, useRef, useState } from 'react'

/**
 * Cuenta regresiva de la sesión (el backend la expira a los 5 minutos).
 *
 * WCAG 2.2 exige que un límite de tiempo sea perceptible y avisado antes de vencer, no
 * que el flujo muera en silencio. Avisamos a los 60 y a los 20 segundos por voz, y el
 * valor se lee siempre desde `expiresAt` del servidor: no es una estimación del cliente.
 */
const WARNING_THRESHOLDS = [60, 20]

function remainingSeconds(expiresAt) {
  return Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
}

function format(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function SessionTimer({ expiresAt, onWarn, onExpire }) {
  const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(expiresAt))
  const firedRef = useRef(new Set())

  useEffect(() => {
    firedRef.current = new Set()

    const tick = () => {
      const left = remainingSeconds(expiresAt)
      setSecondsLeft(left)

      const threshold = WARNING_THRESHOLDS.find((t) => left <= t && !firedRef.current.has(t))
      if (threshold !== undefined) {
        firedRef.current.add(threshold)
        onWarn?.(left)
      }

      if (left === 0) onExpire?.()
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt, onWarn, onExpire])

  const isUrgent = secondsLeft <= 60

  return (
    <p className={`timer ${isUrgent ? 'timer--urgent' : ''}`}>
      {/* El texto visible es abreviado; el lector de pantalla recibe la versión completa. */}
      <span aria-hidden="true">Sesión: {format(secondsLeft)}</span>
      <span className="visually-hidden">
        Quedan {secondsLeft} segundos para completar la autenticación.
      </span>
    </p>
  )
}
