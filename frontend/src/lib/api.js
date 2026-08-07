const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * FastAPI devuelve los errores en `detail`, que puede ser un string (HTTPException)
 * o una lista de objetos (errores de validación de Pydantic). Normalizamos ambos a
 * un mensaje legible, porque este mensaje se lee en voz alta al usuario.
 */
function describeDetail(detail, status) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first = detail[0]
    if (first?.msg) return first.msg
  }
  return `El servidor respondió con un error ${status}.`
}

async function parseResponse(response) {
  const raw = await response.text()

  let body = null
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = { detail: raw }
    }
  }

  if (!response.ok) {
    throw new ApiError(describeDetail(body?.detail, response.status), response.status, body)
  }
  return body
}

async function request(path, options) {
  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, options)
  } catch (cause) {
    throw new ApiError('No se pudo contactar al servidor de autenticación.', 0, { cause: String(cause) })
  }
  return parseResponse(response)
}

export const api = {
  /** @returns {Promise<Array<{id:number, username:string, required_factors:Record<string,string>, enrolled_factors:string[]}>>} */
  listUsers() {
    return request('/users', { method: 'GET' })
  },

  getUser(username) {
    return request(`/users/${encodeURIComponent(username)}`, { method: 'GET' })
  },

  startAuth(username) {
    const form = new FormData()
    form.append('username', username)
    return request('/auth/start', { method: 'POST', body: form })
  },

  verifyVoice(sessionId, audioBlob) {
    const form = new FormData()
    form.append('session_id', sessionId)
    form.append('audio', audioBlob, 'verification.wav')
    return request('/verify', { method: 'POST', body: form })
  },

  requestHapticChallenge(sessionId) {
    const form = new FormData()
    form.append('session_id', sessionId)
    return request('/auth/haptic/challenge', { method: 'POST', body: form })
  },

  verifyHaptic(sessionId, selections) {
    return request('/verify/haptic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, selections }),
    })
  },

  verifyGesture(sessionId, points) {
    return request('/verify/gesture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, points }),
    })
  },
}
