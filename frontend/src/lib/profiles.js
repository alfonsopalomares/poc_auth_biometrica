/**
 * Perfiles de la demo.
 *
 * La PoC no pide identificarse: el usuario está fijado de antemano. Elegir usuario en una
 * lista es justamente el tipo de interacción que un usuario no vidente no puede resolver
 * sin explorar la pantalla, y no es lo que la demo quiere evaluar.
 *
 * `vision: 'none'` describe el perfil para el que está diseñada la interacción actual:
 * toda la pantalla es el control, nada depende de encontrar un elemento.
 */
export const PROFILES = {
  carlos: {
    username: 'carlos',
    label: 'Carlos',
    vision: 'none',
    description: 'Perfil sin visión: interacción íntegramente táctil y sonora.',
  },
  // Ana (baja visión) se suma acá cuando se defina su tratamiento visual —
  // presumiblemente tipografía ampliada y alto contraste sobre este mismo flujo.
}

export const DEFAULT_PROFILE = PROFILES.carlos
