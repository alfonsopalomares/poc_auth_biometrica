export const FACTOR = {
  voice: {
    id: 'voice',
    noun: 'voz',
    title: 'Verificación por voz',
    /** Lo que se dice y se muestra cuando toca este factor. */
    instruction:
      'Hablá durante al menos siete segundos con tu tono habitual. Podés decir lo que quieras: el sistema reconoce tu voz, no las palabras.',
  },
  gesture: {
    id: 'gesture',
    noun: 'gesto',
    title: 'Verificación por gesto',
    instruction:
      'Dibujá tu gesto con un dedo en cualquier parte del recuadro y del tamaño que te resulte cómodo. Se compara la forma y el ritmo del trazo, no dónde lo hiciste.',
  },
  haptic: {
    id: 'haptic',
    noun: 'números hápticos',
    title: 'Números hápticos',
    instruction:
      'Tu secreto es una secuencia de números. Vas a percibir grupos de vibraciones; tocá la pantalla cuando el grupo tenga la cantidad de tu número. Se repiten sin límite de tiempo.',
  },
}

export function factorNoun(id) {
  return FACTOR[id]?.noun ?? id
}

/**
 * Describe la secuencia configurada en prosa, para leerla en voz alta.
 * @param {Record<string, string>} requiredFactors p. ej. {"1": "voice", "2": "gesture"}
 */
export function describeSequence(requiredFactors) {
  const ordered = orderedFactors(requiredFactors)
  if (!ordered.length) return 'sin factores configurados'
  if (ordered.length === 1) return `un factor: ${factorNoun(ordered[0])}`
  return `${ordered.length} factores, en este orden: ${ordered.map(factorNoun).join(', luego ')}`
}

/** @returns {string[]} los factores en el orden numérico de sus claves. */
export function orderedFactors(requiredFactors) {
  if (!requiredFactors) return []
  return Object.entries(requiredFactors)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value)
}
