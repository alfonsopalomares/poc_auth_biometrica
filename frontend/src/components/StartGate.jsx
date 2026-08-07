import { useState } from 'react'
import { unlockAudio } from '../lib/earcons'
import { PATTERN, vibrate } from '../lib/haptics'
import { unlockSpeech } from '../lib/speech'

/**
 * Cuánto esperamos al permiso de micrófono antes de seguir igual.
 *
 * El diálogo del sistema puede quedar abierto indefinidamente si el usuario no lo
 * contesta — y si no ve la pantalla, puede ni enterarse de que está ahí. Sin este corte
 * la aplicación se quedaría esperando para siempre, muda.
 */
const PERMISSION_TIMEOUT_MS = 12000

/**
 * Primer toque de la demo.
 *
 * Existe por una restricción de los navegadores móviles: la síntesis de voz y el audio
 * sólo se habilitan dentro de un gesto del usuario. Sin este toque, todos los anuncios
 * posteriores se descartan en silencio — y un usuario no vidente se quedaría sin ninguna
 * guía, sin saber por qué.
 *
 * Aprovechamos el mismo gesto para pedir el permiso de micrófono. Si se pidiera recién al
 * mantener apretado para grabar, el diálogo del sistema robaría el foco en mitad de la
 * pulsación y arruinaría la primera captura.
 */
export default function StartGate({ profile, announce, onReady }) {
  const [preparing, setPreparing] = useState(false)

  const handleActivate = async () => {
    if (preparing) return
    setPreparing(true)

    unlockSpeech()
    unlockAudio()
    vibrate(PATTERN.stepStart)
    announce('Pidiendo permiso para usar el micrófono. Si aparece un aviso, aceptalo.')

    let timer
    const permission = navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop())
      })
      .catch(() => {
        // Denegado o no disponible: seguimos igual. El error real aparece al intentar
        // grabar, con un mensaje que distingue permiso de contexto inseguro.
      })

    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, PERMISSION_TIMEOUT_MS)
    })

    await Promise.race([permission ?? Promise.resolve(), deadline])
    clearTimeout(timer)

    onReady()
  }

  return (
    <button type="button" className="surface surface--gate" onClick={handleActivate}>
      <span className="surface__eyebrow">Prueba de concepto</span>
      <span className="surface__title">Acceso seguro accesible</span>
      <span className="surface__hint">
        {preparing
          ? 'Preparando el micrófono…'
          : `Tocá en cualquier parte de la pantalla para comenzar la autenticación de ${profile.label}.`}
      </span>
    </button>
  )
}
