import { FACTOR, orderedFactors } from '../lib/factors'

/**
 * Progreso de la secuencia de factores.
 *
 * Es una lista ordenada real, no una fila de puntitos: así el lector de pantalla anuncia
 * "elemento 2 de 2" y el estado de cada paso va en texto, no sólo en color.
 */
export default function FactorProgress({ requiredFactors, completedFactors, currentFactor }) {
  const sequence = orderedFactors(requiredFactors)
  if (sequence.length <= 1) return null

  const statusOf = (factorId) => {
    if (completedFactors.includes(factorId)) return { key: 'done', label: 'completado' }
    if (factorId === currentFactor) return { key: 'current', label: 'en curso' }
    return { key: 'pending', label: 'pendiente' }
  }

  return (
    <nav aria-label="Progreso de la autenticación">
      <ol className="progress">
        {sequence.map((factorId, index) => {
          const status = statusOf(factorId)
          return (
            <li
              key={`${factorId}-${index}`}
              className={`progress__step progress__step--${status.key}`}
              aria-current={status.key === 'current' ? 'step' : undefined}
            >
              <span className="progress__index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="progress__label">
                {FACTOR[factorId]?.noun ?? factorId}
                <span className="progress__status"> · {status.label}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
