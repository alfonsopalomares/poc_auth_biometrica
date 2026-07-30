#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
PORT_FRONTEND="5174"
PORT_BACKEND="8000"
AUTH_PROXY_PORT="8001" # Default port for the authentication proxy
TUNNEL_URL="" # This will be set dynamically

log() {
  echo "[start-tunnel] $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[start-tunnel] Faltan dependencias: $1. Por favor, instálalo." >&2
    exit 1
  }
}

ensure_backend() {
  log "Ensuring backend is running on port $PORT_BACKEND"
  lsof -t -i:"$PORT_BACKEND" | xargs -r kill -9 || true
  sleep 1 # Give the OS a moment to release the port
  (
    cd "$BACKEND_DIR"
    "$ROOT_DIR/.venv/bin/python" -m uvicorn app:app --host 127.0.0.1 --port "$PORT_BACKEND"
  ) >"$ROOT_DIR/backend.log" 2>&1 &
}

ensure_frontend() {
  log "Ensuring frontend is running on port $PORT_FRONTEND"
  lsof -t -i:"$PORT_FRONTEND" | xargs -r kill -9 || true
  sleep 1 # Give the OS a moment to release the port
  (
    cd "$FRONTEND_DIR"
    VITE_USE_HTTPS=false npm run dev -- --host 0.0.0.0 --port "$PORT_FRONTEND"
  ) >"$ROOT_DIR/frontend.log" 2>&1 &
}

ensure_auth_proxy() {
  log "Ensuring auth proxy is running on port $AUTH_PROXY_PORT"
  lsof -t -i:"$AUTH_PROXY_PORT" | xargs -r kill -9 || true
  sleep 1 # Give the OS a moment to release the port
  # Bind the proxy to 0.0.0.0 to ensure it listens on both IPv4 and IPv6,
  # which helps ngrok connect correctly.
  (
    cd "$ROOT_DIR"
    AUTH_USER="$TUNNEL_USER" AUTH_PASSWORD="$TUNNEL_PASSWORD" AUTH_PROXY_PORT="$AUTH_PROXY_PORT" AUTH_PROXY_HOST="0.0.0.0" "$ROOT_DIR/.venv/bin/python" auth_proxy.py
  ) >"$ROOT_DIR/auth_proxy.log" 2>&1 &
}

ensure_tunnel() {
  log "Asegurando que ngrok esté corriendo"
  # Detener procesos de ngrok anteriores
  pkill -f ngrok || true
  sleep 1

  require_cmd ngrok
  require_cmd jq

  log "Iniciando ngrok en el puerto $AUTH_PROXY_PORT"
  # Iniciar ngrok en segundo plano
  ngrok http "$AUTH_PROXY_PORT" --log "$ROOT_DIR/tunnel.log" &
  
  log "Esperando la API de ngrok..."
  # Esperar un poco para que el agente de ngrok inicie
  for i in {1..5}; do
    if curl -s http://127.0.0.1:4040/api/tunnels &>/dev/null; then
      break
    fi
    log "Esperando que el API de ngrok esté disponible en http://127.0.0.1:4040... ($i/5)"
    sleep 2
  done

  if ! curl -s http://127.0.0.1:4040/api/tunnels &>/dev/null; then
    log "Error: El API de ngrok no respondió después de varios intentos."
    tail -n 20 "$ROOT_DIR/tunnel.log"
    exit 1
  fi
  
  # Obtener la URL pública de la API local de ngrok usando jq para más robustez
  TUNNEL_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[] | select(.proto=="https") | .public_url')
  
  if [[ -z "$TUNNEL_URL" || ! "$TUNNEL_URL" == https://* ]]; then
    log "Error: No se pudo obtener la URL del túnel de ngrok."
    log "Respuesta de la API:"
    curl -s http://127.0.0.1:4040/api/tunnels
    log "Logs de ngrok en tunnel.log:"
    tail -n 20 "$ROOT_DIR/tunnel.log"
    exit 1
  fi
  
  log "El túnel de ngrok está disponible en: $TUNNEL_URL"
}

main() {
  # Validar que las credenciales del túnel estén definidas
  if [[ -z "${TUNNEL_USER:-}" ]] || [[ -z "${TUNNEL_PASSWORD:-}" ]]; then
    log "INFO: Las variables de entorno TUNNEL_USER y/o TUNNEL_PASSWORD no están definidas. Usando valores predeterminados."
    TUNNEL_USER="charly"
    TUNNEL_PASSWORD="V3l3z"
  fi

  require_cmd lsof
  require_cmd python
  require_cmd npm
  require_cmd curl

  # La función ensure_tunnel ahora agrega 'ngrok' a los requerimientos
  
  ensure_backend
  sleep 2
  ensure_frontend
  sleep 2
  ensure_auth_proxy
  sleep 5 # Aumentar el tiempo de espera para que el proxy de autenticación se inicie completamente
  ensure_tunnel

  echo
  echo "URL pública del túnel (via ngrok):"
  echo "$TUNNEL_URL"
  echo
  echo "Credenciales de autenticación básica:"
  echo "Usuario: $TUNNEL_USER"
  echo "Contraseña: $TUNNEL_PASSWORD"
  echo
  echo "La URL pública ahora apunta al proxy con autenticación."
  echo "Rutas de prueba:"
  echo "$TUNNEL_URL/admin"
  echo "$TUNNEL_URL/api/logs"
  echo
  echo "Logs disponibles en:"
  echo "  - Túnel: $ROOT_DIR/tunnel.log"
  echo "  - Proxy de autenticación: $ROOT_DIR/auth_proxy.log"
  echo "  - Backend: $ROOT_DIR/backend.log"
  echo "  - Frontend: $ROOT_DIR/frontend.log"

  # Restaura la configuración de la terminal en caso de que ngrok la haya alterado.
  stty sane
}

main "$@"
