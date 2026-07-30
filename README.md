# PoC

## Descripción
Esta Prueba de Concepto (PoC) demuestra un sistema de autenticación biométrica multimodal que combina voz y gestos táctiles. El objetivo es explorar métodos de verificación robustos, seguros y accesibles, especialmente para usuarios con discapacidad visual.

-   **Backend (`backend/`):** Un servicio construido con FastAPI que implementa la lógica de registro y verificación para biometría de voz y gestos.
-   **Frontend (`frontend/`):** Una aplicación de demostración en React + Vite para la autenticación por voz.
-   **Paneles de Administración (`backend/static/`):** Páginas HTML simples para probar y visualizar las modalidades biométricas de forma aislada.

## Requisitos

- Python 3.14+ para el backend.
- Node 18 para el frontend (`frontend/.nvmrc`).
- Navegador compatible con `MediaRecorder`, `Vibration API` y `aria-live`.

## Estructura del proyecto

- `backend/`: servidor FastAPI + pruebas + exportación de OpenAPI.
- `frontend/`: aplicación React accesible.
- `.venv/`: entorno Python local.

## Backend

### Instalar dependencias

```bash
cd backend/
pip install -r requirements.txt # (Asegúrate de tener un requirements.txt o instala manualmente)
# pip install fastapi "uvicorn[standard]" sqlalchemy speechbrain torchaudio librosa numpy
```

### Ejecutar servidor

```bash
cd /Users/alfonso/doctorado/PoC/backend
source ../.venv/bin/activate
uvicorn app:app --reload
```

El backend quedará disponible en `http://127.0.0.1:8000`.

### API principal

#### `POST /api/challenge/request`

- Inicia la sesión de verificación.
- Genera `session_id`, `seed` y el tipo de desafío.

Ejemplo de respuesta:

```json
{
  "session_id": "abc123...",
  "challenge_type": "voice_phrase",
  "prompt": "Repite la frase 'abre la puerta' con tu voz.",
  "seed": 123456789
}
```

#### `POST /api/verify/voice`

- Recibe audio en `multipart/form-data` y el `session_id`.
- Devuelve una puntuación de confianza `humanity_score`.

Ejemplo de uso:

```bash
curl -X POST "http://127.0.0.1:8000/api/verify/voice" \
  -F "session_id=<SESSION_ID>" \
  -F "audio=@path/to/audio.wav;type=audio/wav"
```

Ejemplo de respuesta:

```json
{
  "humanity_score": 0.78,
  "noise_score": 0.23,
  "challenge_type": "voice_phrase"
}
```

#### `POST /api/verify/gesture`

- Recibe la matriz temporal de puntos `[{x, y, t}]`.
- Devuelve una puntuación de coincidencia del gesto.

Ejemplo de cuerpo JSON:

```json
{
  "session_id": "abc123...",
  "points": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.2], [1.0, 1.0, 0.4]]
}
```

Ejemplo de respuesta:

```json
{
  "gesture_score": 0.64,
  "challenge_type": "gesture_pattern"
}
```

#### `GET /api/auth/status/{session_id}`

- Combina los resultados de voz y gesto.
- Aplica una ponderación adaptativa según el ruido.

Ejemplo de respuesta:

```json
{
  "session_id": "abc123...",
  "voice_score": 0.72,
  "gesture_score": 0.60,
  "noise_score": 0.18,
  "voice_weight": 0.6,
  "gesture_weight": 0.4,
  "combined_score": 0.67,
  "auth_status": "authorized"
}
```

### Pruebas del backend

#### PyTorch

```bash
cd /Users/alfonso/doctorado/PoC
source .venv/bin/activate
python backend/test/torch/test_torch.py
```

#### API

```bash
cd /Users/alfonso/doctorado/PoC
source .venv/bin/activate
pytest backend/test/test_api.py
```

### OpenAPI / Swagger

El backend expone documentación automática:

- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`
- OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

Para exportar el esquema a un archivo local:

```bash
cd /Users/alfonso/doctorado/PoC/backend
source ../.venv/bin/activate
python export_openapi.py
```

El archivo queda en `backend/openapi.json`.

## Frontend

### Entorno React

El frontend usa Node 18 y `frontend/.nvmrc` fija la versión:

```text
18
```

También incluye `frontend/.env.example`:

```text
VITE_API_BASE_URL=/api
```

Si necesitas valores locales, copia el archivo:

```bash
cd /Users/alfonso/doctorado/PoC/frontend
cp .env.example .env
```

### Instalar dependencias

```bash
cd /Users/alfonso/doctorado/PoC/frontend
nvm use
npm install
```

### Ejecutar frontend

```bash
cd /Users/alfonso/doctorado/PoC/frontend
npm run dev -- --host 0.0.0.0
```

El frontend se sirve en `http://localhost:5173/`.

Para acceder desde otra máquina en tu red local, usa la dirección IP de tu equipo macOS, por ejemplo:

```text
http://192.168.1.42:5173
```

Si necesitas conocer tu IP local, puedes ejecutarlo en macOS:

```bash
ipconfig getifaddr en0
```

### Componentes claves

- `src/App.jsx`: orquesta el flujo de autenticación.
- `src/components/AccessibilityAnnouncer.jsx`: `aria-live` assertive para lectores de pantalla.
- `src/components/VoiceAudioEngine.jsx`: captura audio con `MediaRecorder`.
- `src/components/TactileSkinsCanvas.jsx`: captura gesto táctil y vibración guiada.

## Ejecutar todo en modo local

1. Inicia el backend:

```bash
cd /Users/alfonso/doctorado/PoC/backend
source ../.venv/bin/activate
uvicorn app:app --reload
```

2. En otra terminal, inicia el frontend:

```bash
cd /Users/alfonso/doctorado/PoC/frontend
nvm use
npm run dev
```

3. Abre el navegador en `http://localhost:5173/`.

4. Verifica que las llamadas a la API usen rutas relativas `/api/*` y que el backend esté disponible en `http://127.0.0.1:8000`.

## Nota

Este proyecto está diseñado como PoC: el frontend y backend están en el mismo repositorio, con dependencias aisladas en `.venv/` para Python y `node_modules/` para React.
