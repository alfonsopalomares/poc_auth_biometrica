# PoC

## Descripción
Esta Prueba de Concepto (PoC) demuestra un sistema de autenticación biométrica multimodal que combina voz y gestos táctiles. El objetivo es explorar métodos de verificación robustos, seguros y accesibles, especialmente para usuarios con discapacidad visual.

-   **Backend (`backend/`):** Un servicio construido con FastAPI que implementa la lógica de registro y verificación para biometría de voz y gestos.
-   **Frontend (`frontend/`):** La aplicación de usuario final en React + Vite: el flujo de login MFA accesible (voz y gesto). El enrolamiento y la administración se hacen desde los paneles de `/admin`.
-   **Paneles de Administración (`backend/static/`):** Páginas HTML simples para crear usuarios, registrar biometría y probar las modalidades de forma aislada.

## Requisitos

- Python 3.14+ para el backend.
- Node 20 para el frontend (`frontend/.nvmrc`).
- Navegador compatible con `MediaRecorder`, Pointer Events y `aria-live`. La `Vibration API`
  y la síntesis de voz son opcionales: si faltan, la interfaz lo detecta y deshabilita
  esos canales en vez de ofrecer controles que no hacen nada.

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

0.  **Consulta previa (`GET /api/users`, `GET /api/users/{username}`):** Devuelven, por usuario, la secuencia configurada (`required_factors`) y las modalidades que realmente tiene registradas (`enrolled_factors`). Son de sólo lectura y no exponen ningún template biométrico; permiten que el cliente anuncie por adelantado qué se va a pedir.
1.  **Inicio de Sesión (`POST /api/auth/start`):** Se inicia una sesión de autenticación para un usuario, generando un `session_id`. El sistema responde con un desafío para el primer factor de la secuencia y con `expires_at`, el instante en que la sesión caduca.
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

#### Factor Háptico (conocimiento)

A diferencia de los dos anteriores, **no es una biometría**. Existe porque voz y gesto son
ambos "algo que sos" y comparten la misma debilidad: viajan como una muestra que el
servidor no puede distinguir de una grabación. Un gesto idéntico puntúa 1.0 y se acepta.

-   **Desafío-respuesta con permutación fresca.** El secreto es una secuencia de patrones
    vibrotáctiles (`corto`, `largo`, `doble`). En cada ronda el servidor emite una
    permutación nueva; el cliente reproduce los patrones en ese orden y el usuario toca
    durante el que corresponde al símbolo siguiente de su secreto. Lo que viaja es el
    **índice de la ranura**, no el símbolo — así, una respuesta capturada no sirve en la
    sesión siguiente, porque la permutación ya cambió.
-   **Almacenamiento.** Sólo la derivación PBKDF2-SHA256 con sal por usuario, nunca el
    secreto en claro. Un secreto es revocable; una voz no.
-   **Uso único.** El desafío se descarta al primer intento, acierte o falle, y sólo se
    emite si el háptico es realmente el factor que toca en la secuencia.
-   **Sin límite de tiempo.** Los patrones se repiten indefinidamente hasta que el usuario
    responde. Una ventana que se cierra sería una barrera de accesibilidad (WCAG 2.2), no
    una medida de seguridad.
-   **Alternativa sonora.** iOS Safari no implementa la Vibration API, así que el frontend
    detecta su ausencia y reproduce los patrones como tonos con el mismo ritmo. Conviene
    usar auriculares: por audio el patrón deja de ser inobservable.
-   **Entropía.** Con 3 símbolos y 4 posiciones hay 81 combinaciones. Alcanza para una PoC
    porque un fallo invalida la sesión entera, pero en producción habría que alargar el
    secreto o ampliar el alfabeto — limitado a su vez por cuántos patrones vibrotáctiles
    distingue una persona con fiabilidad.

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

`app.py` monta `StaticFiles(directory="static")` con ruta relativa, así que la suite tiene
que ejecutarse con `backend/` como directorio de trabajo:

```bash
cd /Users/alfonso/doctorado/PoC/backend
PYTHONPATH=/Users/alfonso/doctorado/PoC ../.venv/bin/python -m pytest test/test_api.py
```

Nota: `test_end_to_end_flow` falla actualmente. Toma un `session_id` de la API legacy
(`/api/challenge/request`, sesiones en memoria) y lo envía a `/api/verify/gesture`, que
desde la incorporación del flujo MFA es el endpoint respaldado por base de datos y
responde 404. El equivalente legacy pasó a llamarse `/api/verify/gesture-challenge`.

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

Aplicación de usuario final: recorre el flujo MFA del backend (`/api/auth/start` →
`/api/verify` → `/api/verify/gesture`) sin depender de estímulos visuales.

### Principios de diseño

El frontend implementa las conclusiones de la línea de investigación (ver `articulos/`):

- **Toda la pantalla es el control.** No hay botones que localizar ni recuadros que
  encontrar. Se mantiene apretado en cualquier punto para grabar la voz, y se dibuja el
  gesto en cualquier zona. Un usuario no vidente no puede posicionarse sin explorar la
  pantalla elemento por elemento: la solución es eliminar la necesidad de posicionarse,
  no agregarle una guía a un layout que la exige.
- **Mientras el micrófono está abierto, la aplicación queda muda.** Ni voz sintética ni
  actualizaciones de `aria-live`: cualquiera de las dos entraría en la grabación y el
  embedding terminaría describiendo a dos locutores. La única realimentación durante la
  captura es háptica, más un tono corto al cumplirse el mínimo.
- **Multimodalidad, no traducción de lo visual.** La háptica tiene patrones con
  significado propio (inicio de trazo, mínimo alcanzado, factor superado, fallo) y los
  earcons cubren lo que la voz no puede decir sin contaminar la muestra.
- **El mínimo se mide en voz activa, no en tiempo transcurrido.** El backend exige 5 s de
  voz tras descartar silencios (`librosa.effects.split(top_db=25)`), no 5 s de grabación.
  El cliente mide lo mismo, con el mismo criterio de −25 dB respecto del pico: quien habla
  de corrido termina en unos 6 s, y quien hace pausas sostiene más, que es lo correcto —
  lo que hace falta es material de voz, no tiempo con el micrófono abierto. Si el medidor
  no llega a funcionar, se degrada a tiempo de reloj antes que dejar un contador clavado
  que impida alcanzar el mínimo.
- **Sin controles decorativos.** El anillo late con el RMS real del micrófono.
- **Límites de tiempo perceptibles** (WCAG 2.2): la sesión caduca a los 5 minutos y la
  cuenta regresiva usa el `expires_at` que devuelve el servidor, con avisos hablados a
  los 60 y a los 20 segundos.

### Recorrido

La demo tiene el usuario fijado (`src/lib/profiles.js`): elegir de una lista es
justamente el tipo de interacción que el flujo quiere evitar.

| Paso | Interacción | Qué se escucha |
|---|---|---|
| Puerta de entrada | Tocar en cualquier lado | Desbloquea voz y audio (los navegadores móviles los exigen dentro de un gesto) y pide el permiso de micrófono por adelantado, para que el diálogo no interrumpa una pulsación |
| Voz | Mantener apretado en cualquier lado | Consigna hablada; tono al alcanzarse el mínimo de voz; al soltar, "grabación finalizada" |
| Gesto | Dibujar en cualquier lado | Consigna hablada; pulsos mientras el dedo se mueve; se envía solo al levantar el dedo |
| Háptico | Tocar cuando se sienta el patrón propio | Consigna hablada; los patrones se repiten sin límite de tiempo; se confirma con un pulso, nunca diciendo qué ranura se eligió |
| Resultado | Tocar para reiniciar | Autorizado / denegado, con la similitud obtenida |

El permiso de micrófono se espera como máximo 12 s: si el diálogo del sistema queda sin
responder, el flujo sigue igual en vez de quedarse esperando en silencio.

### Estructura

- `src/lib/` — cliente de API, captura de audio, síntesis de voz, earcons, háptica, perfiles.
- `src/hooks/` — anunciador accesible, máquina de estados MFA, grabación por presión sostenida.
- `src/components/` — una superficie a pantalla completa por paso.
- `src/styles/` — tokens con temas claro, oscuro y alto contraste.

### Entorno React

Node 20 (fijado en `frontend/.nvmrc`), React 19 y Vite 7.

`frontend/.env.example` documenta las variables disponibles:

```text
VITE_API_BASE_URL=/api
VITE_BACKEND_TARGET=http://127.0.0.1:8000
VITE_USE_HTTPS=false
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
npm run dev
```

El frontend se sirve en `http://localhost:5173/` y ya escucha en `0.0.0.0`.

Para acceder desde otra máquina en tu red local, usa la dirección IP de tu equipo macOS, por ejemplo:

```text
http://192.168.1.42:5173
```

Si necesitas conocer tu IP local, puedes ejecutarlo en macOS:

```bash
ipconfig getifaddr en0
```

### Probar desde el teléfono (HTTPS en la red local)

`getUserMedia` y la Vibration API sólo funcionan en contextos seguros. `localhost` cuenta
como seguro, pero `http://192.168.x.x` **no**: desde el teléfono, sin TLS, el factor de voz
es inusable. Un script levanta todo con HTTPS, sin exponer nada a internet:

```bash
./start-local-https.sh
```

Hace tres cosas:

1. Detecta la IP de la red local y **regenera el certificado si no la cubre**. La IP cambia
   al saltar de red o al renovarse el DHCP, y un certificado desactualizado rompe el
   handshake en el teléfono con un error que no explica nada.
2. Levanta el backend en `127.0.0.1:8000` y espera a que cargue el modelo de SpeechBrain.
3. Levanta Vite con TLS en `0.0.0.0:5173` e imprime la URL para el teléfono.

El teléfono sólo habla con Vite, que hace de proxy de `/api` al backend por HTTP interno:
no hay contenido mixto y el backend no necesita su propio certificado.

El certificado es autofirmado, así que el navegador del teléfono va a advertir que la
conexión no es privada. Hay que entrar en "Avanzado" / "Mostrar detalles" y continuar;
sin aceptarlo el micrófono no funciona. Si la advertencia molesta en demostraciones,
`mkcert` genera una CA local que se puede instalar en el teléfono para eliminarla.

Para detener todo:

```bash
./stop-local-https.sh
```

Alternativa manual, si ya tenés un certificado válido para tu IP:

```bash
VITE_USE_HTTPS=true npm run dev
```

> `start-tunnel.sh` es otra cosa: publica la PoC **en internet** vía ngrok, detrás de un
> proxy con autenticación básica (`auth_proxy.py`). Sirve para mostrarla a alguien remoto,
> no para probar en la red local.

### Recorrido de la aplicación

1. **Identificación.** Lista los usuarios (`GET /api/users`) y anuncia por adelantado qué
   factores va a pedir la secuencia; avisa si falta alguna modalidad por registrar.
2. **Factores.** Uno por vez, en el orden que impone el backend. Voz con medidor de nivel
   y mínimo de 7 s (el backend exige 5 s de voz activa tras quitar silencios); gesto en un
   pad independiente de posición y escala, con confirmación háptica.
3. **Resultado.** Autorizado, denegado o sesión caducada, con la similitud obtenida.

Una verificación fallida invalida la sesión del lado del backend: hay que empezar de nuevo.

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
