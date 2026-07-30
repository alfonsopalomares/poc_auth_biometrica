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

### Arquitectura de Autenticación

Esta PoC implementa un sistema de autenticación multifactor (MFA) biométrico, diseñado con un enfoque en la seguridad y la accesibilidad.

#### Flujo de Autenticación (MFA)

El sistema utiliza un flujo de autenticación secuencial basado en sesiones. A cada usuario se le puede asignar una secuencia de factores biométricos requeridos (ej. `{"1": "voice", "2": "gesture"}`).

1.  **Inicio de Sesión (`POST /api/auth/start`):** Se inicia una sesión de autenticación para un usuario, generando un `session_id`. El sistema responde con un desafío para el primer factor de la secuencia.
2.  **Verificación de Factores (`POST /api/verify` y `POST /api/verify/gesture`):** El usuario proporciona la biometría solicitada. El backend la procesa y, si es correcta, comprueba si se han completado todos los factores.
    *   Si faltan factores, responde con un nuevo `challenge` para el siguiente factor en la secuencia.
    *   Si todos los factores se han verificado correctamente, responde con `authorized`.
    *   Si una verificación falla o se proporciona en el orden incorrecto, la sesión se invalida y responde con `denied`.

#### Biometría de Voz

-   **Modelo y Procesamiento:** Se utiliza un modelo pre-entrenado de última generación (`speechbrain/spkrec-ecapa-voxceleb`) para extraer las características únicas de la voz de un locutor.
-   **Almacenamiento:** Durante el registro, el sistema procesa la voz del usuario para generar un vector numérico (un *embedding* de 192 dimensiones). **Solo este embedding se almacena en la base de datos**, no el archivo de audio original. Esto garantiza que la voz del usuario no pueda ser reconstruida a partir de los datos guardados.
-   **Verificación:** Para verificar, se genera un nuevo embedding a partir del audio en vivo y se compara con el almacenado mediante **similitud del coseno**. Una puntuación alta indica una alta probabilidad de que sea el mismo locutor.

#### Biometría de Gestos

-   **Filosofía y Accesibilidad:** El sistema está diseñado para ser independiente de la posición y la escala. Un gesto dibujado en una esquina es matemáticamente idéntico a uno gigante en el centro, lo que es crucial para usuarios con discapacidad visual.
-   **Almacenamiento (Cinemática como Biometría):** No nos interesa solo la forma del dibujo, sino *cómo* se dibujó. La velocidad y la aceleración del trazo son características biométricas únicas.
    1.  El trazo se normaliza para eliminar variaciones de posición y tamaño.
    2.  Se extraen las características cinemáticas (deltas `dx, dy, dt`) entre cada punto.
    3.  Esta secuencia de deltas se procesa con un simulador de red neuronal recurrente (**LSTM**) para generar un *embedding* de 128 dimensiones.
    4.  **Solo este embedding cinemático se almacena**, capturando tanto la forma como el ritmo del dibujo, lo que lo hace extremadamente difícil de falsificar.

#### Pasos hacia un Sistema Productivo

Esta PoC sienta las bases, pero para un sistema en producción se requeriría:

-   **Entrenamiento de Modelos Propios:** Recolectar un dataset de gestos de múltiples usuarios para entrenar un modelo LSTM real, en lugar de usar el simulador actual. Esto aumentaría drásticamente la precisión y seguridad.
-   **Calibración de Umbrales:** Realizar un análisis estadístico (curvas ROC) para encontrar los umbrales de aceptación óptimos para voz y gesto, minimizando tanto los falsos positivos (FAR) como los falsos negativos (FRR).
-   **Seguridad Avanzada:** Implementar mecanismos de "prueba de vida" (liveness detection) para prevenir ataques de repetición (replay attacks) con grabaciones de voz o gestos pregrabados.
-   **Infraestructura Escalable:** Migrar de SQLite a una base de datos como PostgreSQL y desplegar la aplicación en un entorno de producción con balanceo de carga.

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
