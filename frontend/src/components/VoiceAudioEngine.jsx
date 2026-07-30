import React, {useEffect, useImperativeHandle, useRef, forwardRef} from 'react'

const VoiceAudioEngine = forwardRef(function VoiceAudioEngine({onComplete, announce}, ref){
  const mediaRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])

  useImperativeHandle(ref, ()=>({
    start: startRecording,
    stop: stopRecording
  }))

  async function getUserMedia(constraints){
    if(typeof window === 'undefined' || typeof navigator === 'undefined'){
      throw new Error('navigator no disponible')
    }

    const isSecure = window.isSecureContext || window.location.protocol === 'https:'
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    if(!isSecure && !isLocalhost){
      throw new Error('getUserMedia requiere contexto seguro (HTTPS) en navegadores móviles. Usa localhost o HTTPS.')
    }

    if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      return navigator.mediaDevices.getUserMedia(constraints)
    }

    const legacyGetUserMedia = navigator.mediaDevices?.webkitGetUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.getUserMedia
    if(legacyGetUserMedia){
      return new Promise((resolve, reject)=>{
        legacyGetUserMedia.call(navigator, constraints, resolve, reject)
      })
    }
    throw new Error('getUserMedia no soportado por este navegador')
  }

  async function startRecording(){
    announce && announce('Preparando grabación de voz...')
    try {
      const stream = await getUserMedia({audio: true})
      mediaRef.current = stream
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ]
      const supportedType = mimeTypes.find((type) => MediaRecorder.isTypeSupported?.(type))
      recorderRef.current = supportedType
        ? new MediaRecorder(stream, {type: supportedType})
        : new MediaRecorder(stream)
      chunksRef.current = []
      recorderRef.current.ondataavailable = (e)=>{ if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
      recorderRef.current.onstop = async ()=>{
        const rawBlob = new Blob(chunksRef.current, {type: recorderRef.current.mimeType || 'audio/webm'})
        const finalBlob = await convertBlobToWav(rawBlob)
        onComplete && onComplete(finalBlob)
        mediaRef.current?.getTracks().forEach(t=>t.stop())
      }
      recorderRef.current.start()
      announce && announce('Grabando...')
    } catch(error) {
      console.error('VoiceAudioEngine error:', error)
      announce && announce(`Error de grabación: ${error.message}`)
      throw error
    }
  }

  function stopRecording(){
    if(recorderRef.current && recorderRef.current.state !== 'inactive'){
      recorderRef.current.stop()
      announce && announce('Grabación detenida')
    }
  }

  async function convertBlobToWav(blob){
    if(blob.type === 'audio/wav') return blob
    if(typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') {
      return blob
    }

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const arrayBuffer = await blob.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      const wavArrayBuffer = audioBufferToWav(audioBuffer)
      return new Blob([wavArrayBuffer], {type: 'audio/wav'})
    } catch (error) {
      console.warn('convertBlobToWav failed, sending raw blob:', error)
      return blob
    }
  }

  function audioBufferToWav(buffer){
    const numOfChan = buffer.numberOfChannels
    const length = buffer.length * numOfChan * 2 + 44
    const bufferArray = new ArrayBuffer(length)
    const view = new DataView(bufferArray)

    function writeString(view, offset, string){
      for(let i = 0; i < string.length; i++){
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }

    let offset = 0
    writeString(view, offset, 'RIFF'); offset += 4
    view.setUint32(offset, 36 + buffer.length * numOfChan * 2, true); offset += 4
    writeString(view, offset, 'WAVE'); offset += 4
    writeString(view, offset, 'fmt '); offset += 4
    view.setUint32(offset, 16, true); offset += 4
    view.setUint16(offset, 1, true); offset += 2
    view.setUint16(offset, numOfChan, true); offset += 2
    view.setUint32(offset, buffer.sampleRate, true); offset += 4
    view.setUint32(offset, buffer.sampleRate * numOfChan * 2, true); offset += 4
    view.setUint16(offset, numOfChan * 2, true); offset += 2
    view.setUint16(offset, 16, true); offset += 2
    writeString(view, offset, 'data'); offset += 4
    view.setUint32(offset, buffer.length * numOfChan * 2, true); offset += 4

    const channelData = []
    for(let i = 0; i < numOfChan; i++){
      channelData.push(buffer.getChannelData(i))
    }

    let interleaved = new Float32Array(buffer.length * numOfChan)
    let index = 0
    for(let i = 0; i < buffer.length; i++){
      for(let channel = 0; channel < numOfChan; channel++){
        interleaved[index++] = channelData[channel][i]
      }
    }

    let offsetData = offset
    for(let i = 0; i < interleaved.length; i++){
      const sample = Math.max(-1, Math.min(1, interleaved[i]))
      view.setInt16(offsetData, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offsetData += 2
    }

    return bufferArray
  }

  useEffect(()=>{
    // cleanup
    return ()=>{
      if(mediaRef.current) mediaRef.current.getTracks().forEach(t=>t.stop())
    }
  },[])

  return null
})

export default VoiceAudioEngine
