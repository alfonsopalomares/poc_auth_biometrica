import { useCallback, useEffect, useRef, useState } from 'react'
import LiveRegion from './components/LiveRegion'
import StartGate from './components/StartGate'
import VoiceSurface from './components/VoiceSurface'
import GestureSurface from './components/GestureSurface'
import HapticSurface from './components/HapticSurface'
import ResultSurface from './components/ResultSurface'
import SessionOverlay from './components/SessionOverlay'
import { useAnnouncer } from './hooks/useAnnouncer'
import { useAuthSession } from './hooks/useAuthSession'
import { usePreferences } from './hooks/usePreferences'
import { earconFailure, earconSuccess } from './lib/earcons'
import { PATTERN, vibrate } from './lib/haptics'
import { DEFAULT_PROFILE } from './lib/profiles'
import { describeSequence, factorNoun } from './lib/factors'

export default function App() {
  const profile = DEFAULT_PROFILE
  usePreferences()

  const { polite, assertive, announce, announceAndWait, resetAnnouncements, setMuted } =
    useAnnouncer()
  const session = useAuthSession()
  const [started, setStarted] = useState(false)

  const {
    phase,
    requiredFactors,
    completedFactors,
    nextFactor,
    expiresAt,
    lastScore,
    lastModality,
    error,
  } = session

  const busy = phase === 'starting' || phase === 'verifying'

  const handleReady = useCallback(() => {
    setStarted(true)
    announce(`Autenticación de ${profile.label}.`)
    session.start(profile.username)
  }, [announce, profile, session])

  const handleRestart = useCallback(() => {
    session.reset()
    resetAnnouncements()
    announce(`Reiniciando. Autenticación de ${profile.label}.`)
    session.start(profile.username)
  }, [announce, profile, resetAnnouncements, session])

  // --- Anuncio del factor en curso ------------------------------------------
  // Cada superficie lee su propia consigna al montarse; acá sólo anunciamos el cambio de
  // paso, y sólo cuando ya se completó alguno, para no pisar la consigna inicial.
  const previousFactorRef = useRef(null)
  useEffect(() => {
    if (phase !== 'challenge' || !nextFactor) return
    if (previousFactorRef.current === nextFactor) return

    const isFirst = previousFactorRef.current === null
    previousFactorRef.current = nextFactor

    vibrate(PATTERN.stepStart)

    if (isFirst) {
      announce(`Tenés ${describeSequence(requiredFactors)}.`)
    } else {
      earconSuccess()
      announce(
        `Factor verificado. Siguiente: ${factorNoun(nextFactor)}. ` +
          `Completaste ${completedFactors.length} de ${Object.keys(requiredFactors).length}.`,
      )
    }
  }, [phase, nextFactor, requiredFactors, completedFactors, announce])

  // --- Desenlaces -----------------------------------------------------------
  const previousPhaseRef = useRef(phase)
  useEffect(() => {
    if (previousPhaseRef.current === phase) return
    previousPhaseRef.current = phase

    if (phase === 'authorized') {
      earconSuccess()
      vibrate(PATTERN.success)
      announce('Acceso autorizado. Verificaste todos los factores requeridos.', { assertive: true })
    } else if (phase === 'denied') {
      earconFailure()
      vibrate(PATTERN.failure)
      announce('Acceso denegado. La verificación no coincidió y la sesión se cerró.', {
        assertive: true,
      })
    } else if (phase === 'expired') {
      earconFailure()
      vibrate(PATTERN.warning)
      announce('La sesión ya no es válida. Tocá para empezar de nuevo.', { assertive: true })
    }

    if (phase === 'idle' || phase === 'starting') previousFactorRef.current = null
  }, [phase, announce])

  // --- Errores recuperables -------------------------------------------------
  const previousErrorRef = useRef(null)
  useEffect(() => {
    if (!error || previousErrorRef.current === error) {
      if (!error) previousErrorRef.current = null
      return
    }
    previousErrorRef.current = error
    if (phase !== 'expired') announce(error, { assertive: true })
  }, [error, phase, announce])

  return (
    <>
      <LiveRegion polite={polite} assertive={assertive} />

      {!started ? (
        <StartGate profile={profile} announce={announce} onReady={handleReady} />
      ) : null}

      {started && phase === 'starting' ? (
        <div className="surface surface--gate">
          <span className="surface__hint">Iniciando la sesión de autenticación…</span>
        </div>
      ) : null}

      {(phase === 'challenge' || phase === 'verifying') && nextFactor === 'voice' ? (
        <VoiceSurface
          onCapture={session.submitVoice}
          announce={announce}
          setMuted={setMuted}
          busy={busy}
        />
      ) : null}

      {(phase === 'challenge' || phase === 'verifying') && nextFactor === 'gesture' ? (
        <GestureSurface onCapture={session.submitGesture} announce={announce} busy={busy} />
      ) : null}

      {(phase === 'challenge' || phase === 'verifying') && nextFactor === 'haptic' ? (
        <HapticSurface
          sessionId={session.sessionId}
          onCapture={session.submitHaptic}
          announceAndWait={announceAndWait}
          busy={busy}
        />
      ) : null}

      <ResultSurface
        phase={phase}
        score={lastScore}
        modality={lastModality}
        onRestart={handleRestart}
      />

      {started ? (
        <SessionOverlay
          profile={profile}
          requiredFactors={requiredFactors}
          completedFactors={completedFactors}
          currentFactor={nextFactor}
          expiresAt={phase === 'challenge' || phase === 'verifying' ? expiresAt : null}
          onExpire={session.expire}
          announce={announce}
        />
      ) : null}
    </>
  )
}
