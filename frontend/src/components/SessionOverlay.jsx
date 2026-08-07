import FactorProgress from './FactorProgress'
import SessionTimer from './SessionTimer'

/**
 * Capa informativa superpuesta a la superficie de captura.
 *
 * Es `pointer-events: none` y `aria-hidden`: no puede robar un toque a la superficie que
 * ocupa toda la pantalla, y no duplica al lector lo que ya se dijo por voz. Está para
 * quien acompaña la demo con la vista, y para dejar registro visual de la sesión.
 */
export default function SessionOverlay({
  profile,
  requiredFactors,
  completedFactors,
  currentFactor,
  expiresAt,
  onExpire,
  announce,
}) {
  const handleWarn = (secondsLeft) => {
    announce?.(`Quedan ${secondsLeft} segundos para completar la autenticación.`, {
      assertive: true,
    })
  }

  return (
    <div className="overlay" aria-hidden="true">
      <div className="overlay__row">
        <span className="overlay__user">{profile.label}</span>
        {expiresAt ? (
          <SessionTimer expiresAt={expiresAt} onWarn={handleWarn} onExpire={onExpire} />
        ) : null}
      </div>

      <FactorProgress
        requiredFactors={requiredFactors}
        completedFactors={completedFactors}
        currentFactor={currentFactor}
      />
    </div>
  )
}
