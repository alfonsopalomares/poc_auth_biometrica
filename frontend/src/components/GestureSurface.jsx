import { useCallback, useEffect, useRef, useState } from 'react'
import { PATTERN, vibrate } from '../lib/haptics'

/** El backend rechaza gestos de menos de 5 puntos. */
const MIN_GESTURE_POINTS = 5

/** Cada cuánto confirmamos con un pulso que el dedo se está siguiendo. */
const TICK_INTERVAL_MS = 70

export const GESTURE_PROMPT =
  'Verificación por gesto. ' +
  'Dibujá tu gesto con un dedo en cualquier parte de la pantalla y del tamaño que quieras. ' +
  'Se compara la forma y el ritmo del trazo, no dónde lo hiciste. ' +
  'Al levantar el dedo se envía automáticamente.'

/**
 * Toda la pantalla es la superficie de dibujo.
 *
 * El backend normaliza posición y escala antes de generar el embedding, así que un trazo
 * hecho en una esquina equivale a uno enorme en el centro. Encerrar eso en un recuadro
 * era una restricción puramente visual: obligaba a encontrar un marco que el usuario no
 * vidente no puede ver. Sin recuadro, la propiedad matemática del backend se vuelve una
 * propiedad de la interacción.
 */
export default function GestureSurface({ onCapture, announce, busy }) {
  const canvasRef = useRef(null)
  const pointsRef = useRef([])
  const drawingRef = useRef(false)
  const startTimeRef = useRef(0)
  const lastTickRef = useRef(0)
  const promptedRef = useRef(false)
  const [status, setStatus] = useState('Dibujá tu gesto en cualquier parte de la pantalla.')

  useEffect(() => {
    if (promptedRef.current) return
    promptedRef.current = true
    announce(GESTURE_PROMPT)
  }, [announce])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const { width, height } = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, width, height)

    const points = pointsRef.current
    if (points.length < 2) return

    ctx.lineWidth = 10
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--pad-stroke').trim() || '#56cffa'

    ctx.beginPath()
    ctx.moveTo(points[0][0] * width, points[0][1] * height)
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i][0] * width, points[i][1] * height)
    }
    ctx.stroke()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
      redraw()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [redraw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (busy) return undefined

    const toNormalized = (event) => {
      const rect = canvas.getBoundingClientRect()
      return [
        Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      ]
    }

    const capture = (pointerId, take) => {
      try {
        if (take) canvas.setPointerCapture?.(pointerId)
        else canvas.releasePointerCapture?.(pointerId)
      } catch {
        /* la captura de puntero es una mejora, no un requisito */
      }
    }

    const handleDown = (event) => {
      event.preventDefault()
      drawingRef.current = true
      startTimeRef.current = performance.now()
      lastTickRef.current = 0
      pointsRef.current = []
      capture(event.pointerId, true)

      const [x, y] = toNormalized(event)
      pointsRef.current.push([x, y, 0])

      vibrate(PATTERN.strokeStart)
      setStatus('Trazando…')
      redraw()
    }

    const handleMove = (event) => {
      if (!drawingRef.current) return
      event.preventDefault()

      const elapsed = performance.now() - startTimeRef.current
      const [x, y] = toNormalized(event)
      pointsRef.current.push([x, y, elapsed])

      if (elapsed - lastTickRef.current >= TICK_INTERVAL_MS) {
        lastTickRef.current = elapsed
        vibrate(6)
      }
      redraw()
    }

    const handleUp = (event) => {
      if (!drawingRef.current) return
      event.preventDefault()
      drawingRef.current = false
      capture(event.pointerId, false)

      const points = pointsRef.current.slice()

      if (points.length < MIN_GESTURE_POINTS) {
        pointsRef.current = []
        redraw()
        vibrate(PATTERN.warning)
        setStatus('Trazo demasiado corto.')
        announce('Trazo demasiado corto. Dibujá un gesto más largo.', { assertive: true })
        return
      }

      vibrate(PATTERN.strokeEnd)
      setStatus(`Gesto capturado: ${points.length} puntos. Enviando…`)
      announce('Gesto capturado. Enviando.')
      onCapture(points)
    }

    canvas.addEventListener('pointerdown', handleDown, { passive: false })
    canvas.addEventListener('pointermove', handleMove, { passive: false })
    canvas.addEventListener('pointerup', handleUp, { passive: false })
    canvas.addEventListener('pointercancel', handleUp, { passive: false })

    return () => {
      canvas.removeEventListener('pointerdown', handleDown)
      canvas.removeEventListener('pointermove', handleMove)
      canvas.removeEventListener('pointerup', handleUp)
      canvas.removeEventListener('pointercancel', handleUp)
    }
  }, [announce, busy, onCapture, redraw])

  return (
    <div className="surface surface--gesture">
      <canvas
        ref={canvasRef}
        className="surface__canvas"
        role="application"
        aria-label="Dibujá tu gesto en cualquier parte de la pantalla"
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="surface__overlay" aria-hidden="true">
        <span className="surface__title">Verificación por gesto</span>
        <span className="surface__hint">{busy ? 'Procesando tu gesto…' : status}</span>
      </div>
    </div>
  )
}
