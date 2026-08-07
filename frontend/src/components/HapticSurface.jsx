import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import {
  HAPTIC_SYMBOLS,
  getChannel,
  isAudioConfirmed,
  patternDuration,
  playSymbol,
  probeVibration,
  setAudioConfirmed,
  setChannel,
} from '../lib/haptic-patterns'
import { earconAudioProbe } from '../lib/earcons'
import { PATTERN, vibrate } from '../lib/haptics'

/** Margen para reaccionar después de percibir un grupo. */
const REACTION_MS = 900

/** Pausa entre repeticiones del ciclo, para que se note que volvió a empezar. */
const CYCLE_GAP_MS = 1300

/** Respiro entre el final de una locución y la primera señal. */
const SETTLE_MS = 700

/** Tras estas vueltas sin respuesta, se recuerda qué hay que hacer. */
const CYCLES_BEFORE_HINT = 2

/** Cuánto se espera la confirmación de que el canal se percibe. */
const PROBE_WINDOW_MS = 7000

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Factor de conocimiento por desafío-respuesta.
 *
 * El secreto es una secuencia de números. Cada número se percibe como esa cantidad de
 * pulsos. En cada ronda el servidor manda una permutación nueva de los tres grupos; el
 * usuario responde cuando percibe el grupo cuya cantidad coincide con su número, y lo que
 * viaja es el índice de la ranura. Como la permutación cambia en cada sesión, una
 * respuesta capturada no sirve dos veces.
 *
 * Regla de sincronía: ninguna señal —vibración o tono— se emite mientras se está hablando.
 * Cada locución se espera hasta que termina de verdad, no durante una cantidad estimada de
 * segundos. Contar pulsos por encima de una voz es imposible, y la voz además tapa los
 * tonos justo cuando hay que prestarles atención.
 */
export default function HapticSurface({ sessionId, onCapture, announceAndWait, busy }) {
  const [status, setStatus] = useState('Preparando…')
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ round: 0, total: 0 })
  const [channel, setChannelState] = useState(getChannel())

  const activeSlot = useRef(null)
  const resolveTap = useRef(null)
  /** 'probe' espera un toque suelto; 'round' espera una ranura. */
  const tapMode = useRef(null)
  const runToken = useRef(null)

  /** Espera un toque; devuelve la ranura que sonaba en ese momento. */
  const captureRound = useCallback(
    (permutation, alive, currentChannel) =>
      new Promise((resolve) => {
        resolveTap.current = resolve
        tapMode.current = 'round'
        let cycles = 0

        const loop = async () => {
          while (resolveTap.current && alive()) {
            for (let slot = 0; slot < permutation.length; slot += 1) {
              if (!resolveTap.current || !alive()) return

              activeSlot.current = slot
              playSymbol(permutation[slot], currentChannel)
              await wait(patternDuration(permutation[slot]) + REACTION_MS)
            }

            cycles += 1
            if (cycles === CYCLES_BEFORE_HINT) {
              // La pista se dice entre ciclos y se espera completa: si sonara encima de
              // los grupos, taparía justamente lo que hay que contar.
              await announceAndWait('Tocá la pantalla justo cuando cuentes la cantidad de tu número.')
              if (!resolveTap.current || !alive()) return
              await wait(SETTLE_MS)
            }

            await wait(CYCLE_GAP_MS)
          }
        }

        loop()
      }),
    [announceAndWait],
  )

  /** Espera un toque suelto, sin ranura asociada. Devuelve true si tocó. */
  const waitForTap = useCallback((ms, alive) => {
    return new Promise((resolve) => {
      let settled = false
      tapMode.current = 'probe'
      resolveTap.current = () => {
        if (settled) return
        settled = true
        resolveTap.current = null
        tapMode.current = null
        resolve(true)
      }
      setTimeout(() => {
        if (settled || !alive()) return
        settled = true
        resolveTap.current = null
        tapMode.current = null
        resolve(false)
      }, ms)
    })
  }, [])

  const handleTap = useCallback(() => {
    const resolve = resolveTap.current
    if (!resolve) return

    if (tapMode.current === 'probe') {
      vibrate(PATTERN.strokeEnd)
      resolve(true)
      return
    }

    // En una ronda siempre hay una ranura vigente: se fija al empezar cada grupo y se
    // mantiene durante la pausa, de modo que un toque tardío cuenta para el último grupo.
    if (activeSlot.current === null) return

    resolveTap.current = null
    tapMode.current = null
    const slot = activeSlot.current
    activeSlot.current = null

    // Confirmamos con un pulso, nunca diciendo qué ranura eligió: eso es la respuesta.
    vibrate(PATTERN.strokeEnd)
    resolve(slot)
  }, [])

  useEffect(() => {
    const token = {}
    runToken.current = token
    const alive = () => runToken.current === token

    /** Averigua el canal preguntándole al usuario: no hay forma de deducirlo. */
    const negotiateChannel = async () => {
      const stored = getChannel()
      if (stored) return stored

      setStatus('Comprobando si tu teléfono vibra…')
      await announceAndWait(
        'Antes de empezar vamos a comprobar si tu teléfono vibra. ' +
          'Si sentís la vibración, tocá la pantalla. Si no sentís nada, no toques y seguimos con sonido.',
      )
      if (!alive()) return 'audio'
      await wait(SETTLE_MS)

      probeVibration()
      await wait(900)
      probeVibration()

      const felt = await waitForTap(PROBE_WINDOW_MS, alive)
      if (!alive()) return 'audio'

      const chosen = felt ? 'vibration' : 'audio'
      setChannel(chosen)
      return chosen
    }

    /** Confirma que los tonos se escuchan. No alcanza con que el audio esté activo. */
    const confirmAudio = async () => {
      let heard = false
      for (let attempt = 0; attempt < 2 && !heard; attempt += 1) {
        setStatus('Probando el sonido…')
        await announceAndWait(
          attempt === 0
            ? 'No vamos a usar vibración: los números van a sonar como grupos de tonos. ' +
                'Ahora vas a escuchar dos tonos de prueba. Si los escuchás, tocá la pantalla.'
            : 'No escuchaste los tonos. Subí el volumen del teléfono y, si es un iPhone, ' +
                'fijate que el interruptor de silencio esté desactivado. Probamos otra vez: ' +
                'tocá la pantalla si los escuchás.',
        )
        if (!alive()) return
        await wait(SETTLE_MS)

        earconAudioProbe()
        heard = await waitForTap(PROBE_WINDOW_MS, alive)
        if (!alive()) return
      }

      if (heard) {
        setAudioConfirmed()
      } else {
        await announceAndWait(
          'Seguimos igual, pero si no escuchás los tonos no vas a poder completar este factor. ' +
            'Conviene revisar el volumen o usar auriculares.',
        )
      }
    }

    /** Hace percibir cada número con su nombre, para que haya una referencia. */
    const runPractice = async (currentChannel) => {
      const verbo = currentChannel === 'vibration' ? 'sentís' : 'escuchás'
      await announceAndWait(
        'Tu secreto es una secuencia de números, y cada número son esa cantidad de señales seguidas. ' +
          `Vamos a probarlos: prestá atención a cuántas ${verbo}.`,
      )
      if (!alive()) return

      for (const symbol of HAPTIC_SYMBOLS) {
        if (!alive()) return
        setStatus(`Así se percibe el ${symbol}.`)

        // Primero se dice el número, después se emite: nunca a la vez.
        await announceAndWait(`Número ${symbol}.`)
        if (!alive()) return
        await wait(SETTLE_MS)

        playSymbol(symbol, currentChannel)
        await wait(patternDuration(symbol) + 1200)
      }
    }

    const run = async () => {
      let challenge
      try {
        challenge = await api.requestHapticChallenge(sessionId)
      } catch (cause) {
        if (!alive()) return
        setError(cause.message)
        await announceAndWait(`No se pudo preparar el desafío háptico: ${cause.message}`, {
          assertive: true,
        })
        return
      }
      if (!alive()) return

      const currentChannel = await negotiateChannel()
      if (!alive()) return
      setChannelState(currentChannel)

      if (currentChannel === 'audio' && !isAudioConfirmed()) {
        await confirmAudio()
        if (!alive()) return
      }

      await runPractice(currentChannel)
      if (!alive()) return

      const rounds = challenge.rounds
      setProgress({ round: 0, total: rounds.length })
      await announceAndWait(
        `Empezamos. Tu secreto tiene ${rounds.length} números. ` +
          'En cada posición vas a percibir tres grupos, uno tras otro, y se repiten sin límite de tiempo.',
      )
      if (!alive()) return

      const selections = []
      for (let round = 0; round < rounds.length; round += 1) {
        setProgress({ round: round + 1, total: rounds.length })
        setStatus(`Número ${round + 1} de ${rounds.length}: tocá cuando percibas tu cantidad.`)

        // La consigna se repite en cada ronda y se espera completa. Decir sólo "posición 2
        // de 4" informa dónde estás pero no qué hacer, y arrancar los grupos encima de la
        // voz vuelve imposible contarlos.
        await announceAndWait(
          `Número ${round + 1} de ${rounds.length}. Tocá la pantalla cuando cuentes tu cantidad.`,
        )
        if (!alive()) return
        await wait(SETTLE_MS)

        const slot = await captureRound(rounds[round], alive, currentChannel)
        if (!alive()) return
        selections.push(slot)

        await announceAndWait('Registrado.')
        if (!alive()) return
      }

      setStatus('Comprobando tu secreto…')
      await announceAndWait('Secuencia completa. Comprobando tu secreto.')
      if (!alive()) return
      await onCapture(selections)
    }

    run()

    return () => {
      if (runToken.current === token) runToken.current = null
      resolveTap.current = null
      tapMode.current = null
      activeSlot.current = null
    }
  }, [sessionId, announceAndWait, captureRound, waitForTap, onCapture])

  return (
    <div
      className="surface surface--haptic"
      role="application"
      aria-label="Patrón háptico: tocá la pantalla cuando percibas la cantidad de tu número"
      onPointerDown={(event) => {
        event.preventDefault()
        handleTap()
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="surface__title">Números hápticos</span>
      <span className="surface__hint">{busy ? 'Comprobando tu secreto…' : status}</span>

      {progress.total ? (
        <span className="surface__counter" aria-hidden="true">
          {progress.round}/{progress.total}
        </span>
      ) : null}

      {channel === 'audio' ? (
        <span className="surface__hint surface__hint--muted">
          Sin vibración: los números suenan como grupos de tonos.
        </span>
      ) : null}

      {error ? <span className="surface__error">{error}</span> : null}
    </div>
  )
}
