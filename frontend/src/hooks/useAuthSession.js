import { useCallback, useReducer } from 'react'
import { api, ApiError } from '../lib/api'

/**
 * Máquina de estados del flujo MFA del backend.
 *
 *   idle ──start──► starting ──► challenge ⇄ verifying ──► authorized
 *                                    │                 └──► denied
 *                                    └──────────────────► expired
 *
 * El backend es quien decide: `/api/auth/start` y cada `/api/verify*` devuelven
 * `status` ('challenge' | 'authorized' | 'denied') junto con `next_factors`. Este hook
 * no reimplementa la secuencia, sólo la refleja.
 */

const INITIAL_STATE = {
  phase: 'idle',
  username: null,
  sessionId: null,
  requiredFactors: {},
  completedFactors: [],
  nextFactor: null,
  expiresAt: null,
  lastScore: null,
  /** Última modalidad enviada. Decide cómo se rotula el resultado. */
  lastModality: null,
  message: null,
  /** Error recuperable: el usuario puede reintentar el mismo factor. */
  error: null,
}

function fromServer(state, data) {
  const base = {
    ...state,
    sessionId: data.session_id ?? state.sessionId,
    requiredFactors: data.required_factors ?? state.requiredFactors,
    completedFactors: data.completed_factors ?? state.completedFactors,
    expiresAt: data.expires_at ? new Date(data.expires_at) : state.expiresAt,
    lastScore: data.score ?? null,
    message: data.message ?? null,
    error: null,
  }

  if (data.status === 'challenge') {
    return { ...base, phase: 'challenge', nextFactor: data.next_factors?.[0] ?? null }
  }
  return { ...base, phase: data.status === 'authorized' ? 'authorized' : 'denied', nextFactor: null }
}

/**
 * Un 400/404 sobre la sesión misma es terminal: el backend ya la invalidó y no sirve
 * reintentar. Un 400 sobre la muestra biométrica (audio corto, gesto de pocos puntos)
 * es recuperable y deja la sesión viva.
 */
function isTerminalSessionError(error) {
  if (error.status === 404) return true
  return error.status === 400 && /^session/i.test(error.message)
}

function reducer(state, action) {
  switch (action.type) {
    case 'starting':
      return { ...INITIAL_STATE, phase: 'starting', username: action.username }

    case 'verifying':
      return { ...state, phase: 'verifying', lastModality: action.modality, error: null }

    case 'server':
      return fromServer(state, action.data)

    case 'recoverable-error':
      return { ...state, phase: state.sessionId ? 'challenge' : 'idle', error: action.message }

    case 'terminal-error':
      return { ...state, phase: 'expired', nextFactor: null, error: action.message }

    case 'reset':
      return INITIAL_STATE

    default:
      return state
  }
}

export function useAuthSession() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  const run = useCallback(async (call) => {
    try {
      dispatch({ type: 'server', data: await call() })
      return true
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Ocurrió un error inesperado al verificar.'

      if (error instanceof ApiError && isTerminalSessionError(error)) {
        dispatch({ type: 'terminal-error', message })
      } else {
        dispatch({ type: 'recoverable-error', message })
      }
      return false
    }
  }, [])

  const start = useCallback(
    (username) => {
      dispatch({ type: 'starting', username })
      return run(() => api.startAuth(username))
    },
    [run],
  )

  const submitVoice = useCallback(
    (audioBlob) => {
      dispatch({ type: 'verifying', modality: 'voice' })
      return run(() => api.verifyVoice(state.sessionId, audioBlob))
    },
    [run, state.sessionId],
  )

  const submitGesture = useCallback(
    (points) => {
      dispatch({ type: 'verifying', modality: 'gesture' })
      return run(() => api.verifyGesture(state.sessionId, points))
    },
    [run, state.sessionId],
  )

  const submitHaptic = useCallback(
    (selections) => {
      dispatch({ type: 'verifying', modality: 'haptic' })
      return run(() => api.verifyHaptic(state.sessionId, selections))
    },
    [run, state.sessionId],
  )

  const expire = useCallback(() => {
    dispatch({ type: 'terminal-error', message: 'La sesión de autenticación caducó.' })
  }, [])

  const reset = useCallback(() => dispatch({ type: 'reset' }), [])

  return { ...state, start, submitVoice, submitGesture, submitHaptic, expire, reset }
}
