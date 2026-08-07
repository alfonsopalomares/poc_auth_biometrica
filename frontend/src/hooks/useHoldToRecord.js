import { useCallback, useEffect, useRef, useState } from 'react'
import { MIN_VOICED_MS, VoiceRecorder } from '../lib/audio'
import { earconMinimumReached } from '../lib/earcons'
import { PATTERN, vibrate } from '../lib/haptics'
import { setSpeechSuppressed } from '../lib/speech'

/** Corte de seguridad por si el dedo se queda apoyado. */
const MAX_RECORDING_MS = 30000

/** Por debajo de este pico asumimos que el micrófono no captó voz. */
const SILENCE_PEAK = 0.06

/**
 * Grabación por presión sostenida: el micrófono vive exactamente mientras el dedo está
 * apoyado. No hay que encontrar un botón para empezar ni otro para terminar, que es lo
 * que volvía inusable el flujo anterior sin visión.
 *
 * El mínimo se mide en **voz activa**, no en tiempo transcurrido, porque es lo que exige
 * el backend. Quien habla de corrido termina en unos 6 s; quien hace pausas necesita
 * sostener más, que es exactamente el comportamiento correcto: lo que hace falta es
 * material de voz, no tiempo con el micrófono abierto.
 *
 * Mientras el micrófono está abierto la aplicación queda muda (voz y aria-live): todo lo
 * que se anunciara en ese lapso entraría en la muestra. La única realimentación durante
 * la captura es háptica, más un tono corto al alcanzarse el mínimo.
 */
export function useHoldToRecord({ onCapture, announce, setMuted }) {
  const [phase, setPhase] = useState('idle') // idle | opening | recording | processing
  const [voicedMs, setVoicedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState(null)

  const held = useRef(false)
  const recorderRef = useRef(null)
  const startedAtRef = useRef(0)
  const peakRef = useRef(0)
  const minReachedRef = useRef(false)

  const silence = useCallback(
    (on) => {
      setSpeechSuppressed(on)
      setMuted?.(on)
    },
    [setMuted],
  )

  const reset = useCallback(() => {
    setPhase('idle')
    setVoicedMs(0)
    setLevel(0)
  }, [])

  const discard = useCallback(
    (message) => {
      recorderRef.current?.cancel()
      recorderRef.current = null
      silence(false)
      reset()
      setError(message)
      vibrate(PATTERN.warning)
      announce(message, { assertive: true })
    },
    [announce, reset, silence],
  )

  const stopAndSubmit = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    setPhase('processing')

    let blob
    try {
      blob = await recorder.stop()
    } catch (cause) {
      discard(`No se pudo procesar la grabación: ${cause.message}`)
      return
    }

    // Recién ahora el micrófono está cerrado y se puede volver a hablar.
    silence(false)

    if (peakRef.current < SILENCE_PEAK) {
      reset()
      const message = 'No se detectó tu voz. Acercá el teléfono y probá de nuevo.'
      setError(message)
      vibrate(PATTERN.warning)
      announce(message, { assertive: true })
      return
    }

    setError(null)
    announce('Grabación finalizada. Procesando tu voz.')
    await onCapture(blob)
    reset()
  }, [announce, discard, onCapture, reset, silence])

  const press = useCallback(async () => {
    if (held.current || phase === 'processing' || recorderRef.current) return

    held.current = true
    peakRef.current = 0
    minReachedRef.current = false
    setError(null)
    setVoicedMs(0)
    setPhase('opening')

    // Silenciamos ANTES de abrir el micrófono, no después: ese orden invertido era el que
    // hacía que la propia guía hablada quedara grabada encima de la voz del usuario.
    silence(true)
    vibrate(PATTERN.captureStart)

    // El medidor sólo alimenta el nivel visual y el pico. El avance de voz activa se
    // sondea aparte, para que la interfaz siga viva aunque el medidor nunca arranque.
    const recorder = new VoiceRecorder({
      onMeter: ({ level: value }) => {
        peakRef.current = Math.max(peakRef.current, value)
        setLevel(value)
      },
    })

    try {
      await recorder.start()
    } catch (cause) {
      held.current = false
      silence(false)
      setPhase('idle')
      setError(cause.message)
      announce(`No se pudo abrir el micrófono: ${cause.message}`, { assertive: true })
      return
    }

    // El dedo pudo levantarse mientras el navegador abría el micrófono.
    if (!held.current) {
      recorder.cancel()
      silence(false)
      setPhase('idle')
      announce('Soltaste demasiado rápido. Mantené el dedo apoyado mientras hablás.', {
        assertive: true,
      })
      return
    }

    recorderRef.current = recorder
    startedAtRef.current = Date.now()
    setPhase('recording')
  }, [announce, phase, silence])

  const release = useCallback(() => {
    if (!held.current) return
    held.current = false

    // Si todavía se está abriendo el micrófono, press() detecta el estado y limpia.
    const recorder = recorderRef.current
    if (!recorder) return

    if (recorder.voicedMs < MIN_VOICED_MS) {
      const faltan = Math.ceil((MIN_VOICED_MS - recorder.voicedMs) / 1000)
      discard(
        `Todavía no hablaste lo suficiente: faltaban unos ${faltan} segundos de voz. ` +
          'Mantené el dedo apoyado y hablá sin pausas largas hasta escuchar la señal.',
      )
      return
    }

    stopAndSubmit()
  }, [discard, stopAndSubmit])

  // Sondeo del progreso: avance de voz activa, señal del mínimo y corte de seguridad.
  useEffect(() => {
    if (phase !== 'recording') return undefined

    const id = setInterval(() => {
      const recorder = recorderRef.current
      if (!recorder) return

      const voiced = recorder.voicedMs
      setVoicedMs(voiced)

      if (!minReachedRef.current && voiced >= MIN_VOICED_MS) {
        minReachedRef.current = true
        earconMinimumReached()
        vibrate(PATTERN.factorPassed)
      }

      // El máximo sí se mide en reloj de pared: protege de un dedo olvidado sobre la
      // pantalla, no mide material de voz.
      if (Date.now() - startedAtRef.current >= MAX_RECORDING_MS) {
        held.current = false
        if (voiced >= MIN_VOICED_MS) stopAndSubmit()
        else
          discard(
            'Se alcanzó el máximo de grabación sin suficiente voz. ' +
              'Probá de nuevo hablando de corrido y más cerca del micrófono.',
          )
      }
    }, 200)

    return () => clearInterval(id)
  }, [phase, discard, stopAndSubmit])

  useEffect(
    () => () => {
      recorderRef.current?.cancel()
      setSpeechSuppressed(false)
    },
    [],
  )

  return {
    phase,
    voicedMs,
    level,
    error,
    minimumReached: voicedMs >= MIN_VOICED_MS,
    press,
    release,
  }
}
