import React, {useEffect, useRef} from 'react'

export default function TactileSkinsCanvas({onGestureComplete, announce}){
  const canvasRef = useRef(null)
  const pointsRef = useRef([])
  const rafRef = useRef(null)
  const drawingRef = useRef(false)
  const rectRef = useRef({width: window.innerWidth, height: window.innerHeight, left: 0, top: 0})

  useEffect(()=>{
    const c = canvasRef.current
    const ctx = c.getContext('2d')
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(84, 234, 255, 0.92)'

    function resize(){
      const rect = c.getBoundingClientRect()
      rectRef.current = {width: rect.width, height: rect.height, left: rect.left, top: rect.top}
      const dpr = window.devicePixelRatio || 1
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function draw(){
      const {width, height} = rectRef.current
      ctx.clearRect(0, 0, width, height)
      const pts = pointsRef.current
      if(pts.length > 0){
        ctx.beginPath()
        ctx.moveTo(pts[0].x * width, pts[0].y * height)
        for(let i = 1; i < pts.length; i++){
          ctx.lineTo(pts[i].x * width, pts[i].y * height)
        }
        ctx.stroke()
      }
      rafRef.current = requestAnimationFrame(draw)
    }

    function addPoint(event){
      const rect = rectRef.current
      const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
      const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
      pointsRef.current.push({x, y, t: Date.now()})
    }

    function handlePointerDown(event){
      event.preventDefault()
      drawingRef.current = true
      pointsRef.current = []
      c.setPointerCapture?.(event.pointerId)
      announce && announce('Inició gesto')
      navigator.vibrate?.(30)
      addPoint(event)
    }

    function handlePointerMove(event){
      if(!drawingRef.current) return
      event.preventDefault()
      addPoint(event)
      navigator.vibrate?.(5)
    }

    function handlePointerEnd(event){
      if(!drawingRef.current) return
      event.preventDefault()
      drawingRef.current = false
      c.releasePointerCapture?.(event.pointerId)
      navigator.vibrate?.(50)
      announce && announce('Gesto registrado')
      const points = pointsRef.current.map(p=>[p.x,p.y,p.t])
      onGestureComplete && onGestureComplete(points)
    }

    resize()
    rafRef.current = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)

    c.addEventListener('pointerdown', handlePointerDown, {passive: false})
    c.addEventListener('pointermove', handlePointerMove, {passive: false})
    c.addEventListener('pointerup', handlePointerEnd, {passive: false})
    c.addEventListener('pointercancel', handlePointerEnd, {passive: false})

    return ()=>{
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      c.removeEventListener('pointerdown', handlePointerDown)
      c.removeEventListener('pointermove', handlePointerMove)
      c.removeEventListener('pointerup', handlePointerEnd)
      c.removeEventListener('pointercancel', handlePointerEnd)
    }
  },[announce, onGestureComplete])

  return (
    <canvas ref={canvasRef}
      className="full-canvas"
      aria-label="Lienzo de gestos táctiles"
      role="application"
      tabIndex={0}
      onContextMenu={(e)=>e.preventDefault()} />
  )
}
