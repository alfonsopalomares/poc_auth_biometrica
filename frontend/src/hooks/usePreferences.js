import { useCallback, useEffect, useState } from 'react'
import { setSpeechEnabled, speechSupported } from '../lib/speech'
import { hapticsSupported, setHapticsEnabled } from '../lib/haptics'

const STORAGE_KEY = 'poc-auth-preferences'

const DEFAULTS = {
  speech: true,
  haptics: true,
  highContrast: false,
}

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState(readStored)

  // Las preferencias son la configuración de los canales de salida, así que se aplican
  // a los módulos globales y al documento, no a un componente en particular.
  useEffect(() => {
    setSpeechEnabled(preferences.speech)
    setHapticsEnabled(preferences.haptics)
    document.documentElement.dataset.contrast = preferences.highContrast ? 'high' : 'normal'

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    } catch {
      // Modo privado sin almacenamiento: las preferencias duran lo que la sesión.
    }
  }, [preferences])

  const update = useCallback((key, value) => {
    setPreferences((previous) => ({ ...previous, [key]: value }))
  }, [])

  return {
    preferences,
    updatePreference: update,
    capabilities: { speech: speechSupported, haptics: hapticsSupported },
  }
}
