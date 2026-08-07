const OUTCOME = {
  authorized: {
    title: 'Acceso autorizado',
    tone: 'success',
    body: 'Verificaste todos los factores requeridos.',
  },
  denied: {
    title: 'Acceso denegado',
    tone: 'error',
    body: 'La verificación no coincidió. Por seguridad la sesión se cerró.',
  },
  expired: {
    title: 'Sesión finalizada',
    tone: 'warning',
    body: 'La sesión ya no es válida.',
  },
}

/**
 * Desenlace a pantalla completa. Como el resto del flujo, se opera tocando en cualquier
 * lado: reiniciar no exige encontrar un botón.
 */
export default function ResultSurface({ phase, score, modality, onRestart }) {
  const outcome = OUTCOME[phase]
  if (!outcome) return null

  // El háptico es un factor de conocimiento: acierta o no. Hablar de "similitud" ahí sería
  // describirlo como si fuera una biometría, que es justamente lo que no es.
  const showsSimilarity = typeof score === 'number' && modality !== 'haptic'

  return (
    <button
      type="button"
      className={`surface surface--result surface--${outcome.tone}`}
      onClick={onRestart}
    >
      <span className="surface__title">{outcome.title}</span>
      <span className="surface__hint">{outcome.body}</span>

      {showsSimilarity ? (
        <span className="surface__score">Similitud biométrica: {score.toFixed(3)}</span>
      ) : null}

      <span className="surface__hint surface__hint--muted">
        Tocá en cualquier parte para volver a empezar.
      </span>
    </button>
  )
}
