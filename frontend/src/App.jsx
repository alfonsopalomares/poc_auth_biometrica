import React, {useEffect, useRef, useState} from 'react'
import AccessibilityAnnouncer from './components/AccessibilityAnnouncer'
import VoiceAudioEngine from './components/VoiceAudioEngine'

export default function App(){
  const [username, setUsername] = useState('carlos');
  const [currentAction, setCurrentAction] = useState(null); // 'enroll' or 'verify'
  const [lastResult, setLastResult] = useState(null);
  const [statusText, setStatusText] = useState('Iniciando...')
  const [recording, setRecording] = useState(false)
  const [ariaEvents, setAriaEvents] = useState([])
  const [vibrationEnabled, setVibrationEnabled] = useState(true)
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(true)
  const [userProfile, setUserProfile] = useState('Ciego')
  const [micVolume, setMicVolume] = useState(50)
  const [backgroundNoise, setBackgroundNoise] = useState(10)
  const voiceRef = useRef(null)
  const lastPointerTypeRef = useRef(null)
  
  function speakMessage(message){
    if(typeof window !== 'undefined' && 'speechSynthesis' in window){
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(message)
      utterance.lang = 'es-ES'
      utterance.rate = 1
      utterance.pitch = 1
      utterance.volume = 1
      window.speechSynthesis.speak(utterance)
    }
  }

  function pushAriaEvent(message){
    const event = {time: new Date().toLocaleTimeString(), text: message, type: 'Polite'}
    setAriaEvents((prev)=>[event, ...prev].slice(0,5))
    setStatusText(message)
  }

  function announce(message){
    if (!message) return
    pushAriaEvent(message)
    speakMessage(message)
  }

  function announceElement(message){
    if (!message) return
    const shortMessage = message.replace(/\s+/g, ' ').trim()
    speakMessage(shortMessage)
  }

  useEffect(()=>{
    announce('Bienvenido al simulador de autenticación biométrica. Perfil seleccionado: Ciego');
    setStatusText('Listo. Ingrese un nombre de usuario y elija una acción.');
  },[])

  const handleVoiceComplete = (blob) => {
    if (!currentAction) return;

    if (currentAction === 'enroll') {
      handleEnroll(blob);
    } else if (currentAction === 'verify') {
      handleVerify(blob);
    }
  };

  async function handleEnroll(blob) {
    pushAriaEvent(`Registrando a ${username}...`);
    const formData = new FormData();
    formData.append('username', username);
    formData.append('audio', blob, 'enrollment.wav');

    try {
      const res = await fetch('/api/enroll', { method: 'POST', body: formData });
      const data = await res.json();
      setLastResult(data);
      if (res.ok) {
        announce(`Usuario ${username} registrado con éxito.`);
      } else {
        throw new Error(data.detail || 'Error en el registro');
      }
    } catch (error) {
      console.error('Enrollment error:', error);
      announce(`Error en el registro: ${error.message}`);
      setLastResult({ error: error.message });
    } finally {
      setRecording(false);
      setCurrentAction(null);
    }
  }

  async function handleVerify(blob) {
    pushAriaEvent(`Verificando a ${username}...`);
    const formData = new FormData();
    formData.append('username', username);
    formData.append('audio', blob, 'verification.wav');

    try {
      const res = await fetch('/api/verify', { method: 'POST', body: formData });
      const data = await res.json();
      setLastResult(data);
      if (res.ok) {
        announce(`Verificación completada. Acceso ${data.access}. Puntuación: ${data.score.toFixed(2)}`);
      } else {
        throw new Error(data.detail || 'Error en la verificación');
      }
    } catch (error) {
      console.error('Verification error:', error);
      announce(`Error en la verificación: ${error.message}`);
      setLastResult({ error: error.message });
    } finally {
      setRecording(false);
      setCurrentAction(null);
    }
  }

  const tapTimeoutRef = useRef(null)
  const lastTapRef = useRef(0)
  const touchHandledRef = useRef(false)

  async function startAction(actionType) {
    if (recording) return;
    if (!username) {
      announce('Por favor, ingrese un nombre de usuario primero.');
      return;
    }
    setCurrentAction(actionType);
    if(!voiceRef.current) return
    try {
      await voiceRef.current.start();
      setRecording(true);
      announce(`Iniciando grabación para ${actionType === 'enroll' ? 'registrar' : 'verificar'}.`);
    } catch (error) {
      announce(`Error de grabación: ${error.message}`);
      setCurrentAction(null);
    }
  }

  function handleVoiceButtonTouch(){
    const now = Date.now()
    const diff = now - lastTapRef.current
    lastTapRef.current = now
    touchHandledRef.current = true
    if(diff < 400){
      clearTimeout(tapTimeoutRef.current)
      if (recording) voiceRef.current.stop();
    } else {
      tapTimeoutRef.current = setTimeout(()=>{
        lastTapRef.current = 0;
        touchHandledRef.current = false
      }, 450)
    }
  }

  return (
    <div className="app-container">
      <AccessibilityAnnouncer message={screenReaderEnabled ? statusText : ''} />
      <VoiceAudioEngine ref={voiceRef} onComplete={handleVoiceComplete} announce={announce} />
      
      <div className="top-panel">
        <div className="voice-panel">
          <div className="panel-header">AUTENTICACIÓN BIOMÉTRICA POR VOZ</div>
          <div className="form-group">
            <label htmlFor="username-input">Nombre de Usuario:</label>
            <input
              id="username-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Introduce tu usuario"
              aria-label="Nombre de usuario"
            />
          </div>
          <div className="meter">
            <div className="meter-bar" style={{width: `${micVolume}%`}} />
          </div>
          <div className="meter-label">Amplitud: {micVolume}%</div>
          <div className="actions">
            <button onClick={() => startAction('enroll')} disabled={recording}>
              Registrar Voz
            </button>
            <button onClick={() => startAction('verify')} disabled={recording}>
              Verificar Voz
            </button>
          </div>
          {recording && (
            <button
              className="voice-button stop-button"
              onClick={() => voiceRef.current.stop()}
              onTouchEnd={(e) => { e.preventDefault(); handleVoiceButtonTouch(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  voiceRef.current.stop();
                }
              }}
              aria-pressed={true}
              aria-label="Detener grabación de voz"
              onFocus={() => announceElement('Botón para detener la grabación de voz')}
            >
              DETENER GRABACIÓN
            </button>
          )}
          <div className="button-hint">
            {recording 
              ? `Grabando para ${currentAction === 'enroll' ? 'registrar' : 'verificar'}... Pulsa para detener.`
              : 'Pulsa "Registrar" o "Verificar" para empezar.'}
          </div>
          <div className="voice-meta">
            <div><strong>Discapacidad:</strong> {userProfile}</div>
            <div><strong>Vibración:</strong> {vibrationEnabled ? 'V2_API' : 'OFF'}</div>
            <div><strong>Buffer:</strong> {recording ? 'Grabando' : 'Vacío'}</div>
          </div>
        </div>
      </div>

      {lastResult && (
        <div className="result-panel">
          <div className="panel-header">Último Resultado</div>
          <pre>{JSON.stringify(lastResult, null, 2)}</pre>
        </div>
      )}

      {/* El panel de gestos se puede mantener si se quiere usar la lógica anterior,
          pero para el flujo de enrollment/verify por voz, se puede ocultar o eliminar.
          Lo comentaré por ahora para centrarnos en el flujo principal. */}
      {/* <TactileSkinsCanvas onGestureComplete={handleGestureComplete} announce={(t)=>{if(screenReaderEnabled) pushAriaEvent(t)}} /> */}

      <div className="aria-log-panel">
        <div className="panel-header">ARAI-Live / Evento Vocálico</div>
        <div className="aria-table">
          <div className="aria-row header">
            <div>Hora</div>
            <div>Anuncio ARIA-Live / Evento Vocálico</div>
            <div>Tipo</div>
          </div>
          {ariaEvents.map((event, index)=>(
            <div className="aria-row" key={index}>
              <div>{event.time}</div>
              <div>{event.text}</div>
              <div>{event.type}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bottom-panel">
        <div className="state-box">
          <div className="state-header">ESTADO DE GRABACIÓN</div>
          <div className="state-value">{recording ? 'Activo' : 'Inactivo'}</div>
        </div>
        <div className="state-box">
          <div className="state-header">EVENTOS ARIA</div>
          <div className="state-value">{ariaEvents.length} registrados</div>
        </div>
      </div>

      <div className="control-panel">
        <label className="toggle-row">
          <span>API de Vibración</span>
          <button
            className={`toggle-button ${vibrationEnabled ? 'on' : 'off'}`}
            onClick={()=>setVibrationEnabled(!vibrationEnabled)}
            onFocus={()=>announceElement('Botón vibración ' + (vibrationEnabled ? 'activada' : 'desactivada'))}
            onPointerEnter={()=>announceElement('Botón vibración ' + (vibrationEnabled ? 'activada' : 'desactivada'))}
            aria-label={`API de vibración ${vibrationEnabled ? 'activada' : 'desactivada'}`}
          >
            {vibrationEnabled ? 'ON' : 'OFF'}
          </button>
        </label>
        <label className="toggle-row">
          <span>Lector de Pantalla</span>
          <button
            className={`toggle-button ${screenReaderEnabled ? 'on' : 'off'}`}
            onClick={()=>setScreenReaderEnabled(!screenReaderEnabled)}
            onFocus={()=>announceElement('Botón lector de pantalla ' + (screenReaderEnabled ? 'activado' : 'desactivado'))}
            onPointerEnter={()=>announceElement('Botón lector de pantalla ' + (screenReaderEnabled ? 'activado' : 'desactivado'))}
            aria-label={`Lector de pantalla ${screenReaderEnabled ? 'activado' : 'desactivado'}`}
          >
            {screenReaderEnabled ? 'ON' : 'OFF'}
          </button>
        </label>
        <label className="select-row">
          <span>Perfil de Usuario</span>
          <select
            value={userProfile}
            onChange={(e)=>setUserProfile(e.target.value)}
            onFocus={()=>announceElement('Selector de perfil de usuario, actualmente ' + userProfile)}
            onPointerEnter={()=>announceElement('Selector de perfil de usuario')}
            aria-label="Perfil de usuario"
          >
            <option>Ciego</option>
            <option>Con baja visión</option>
            <option>Auditivo</option>
          </select>
        </label>
        <label className="slider-row">
          <span>Volumen Micrófono</span>
          <input
            type="range"
            min="0"
            max="100"
            value={micVolume}
            onChange={(e)=>setMicVolume(e.target.value)}
            onFocus={()=>announceElement('Control de volumen de micrófono')}
            onPointerEnter={()=>announceElement('Control de volumen de micrófono')}
            aria-label="Volumen de micrófono"
          />
          <span>{micVolume}</span>
        </label>
        <label className="slider-row">
          <span>Ruido de Fondo</span>
          <input
            type="range"
            min="0"
            max="100"
            value={backgroundNoise}
            onChange={(e)=>setBackgroundNoise(e.target.value)}
            onFocus={()=>announceElement('Control de ruido de fondo')}
            onPointerEnter={()=>announceElement('Control de ruido de fondo')}
            aria-label="Ruido de fondo"
          />
          <span>{backgroundNoise}</span>
        </label>
      </div>
    </div>
  )
}
