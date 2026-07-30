#!/usr/bin/env bash
#
# Script para detener todos los servicios de la PoC (backend, frontend, proxy y túnel).
#

set -e # Salir inmediatamente si un comando falla.

# --- Configuración ---
# Puertos utilizados por los servicios. Deben coincidir con start-tunnel.sh
PORT_FRONTEND="5174"
PORT_BACKEND="8000"
AUTH_PROXY_PORT="8001"

# --- Funciones ---
log() {
  echo "[stop-tunnel] $*"
}

# Función para detener un proceso por el puerto que utiliza
kill_by_port() {
  local port="$1"
  local description="$2"

  log "Intentando detener el servicio en el puerto $port ($description)..."
  # 'lsof -t -i:PORT' devuelve el PID del proceso.
  # El comando se envuelve para evitar errores si no hay PIDs.
  local pids
  pids=$(lsof -t -i:"$port" 2>/dev/null || true)

  if [ -n "$pids" ]; then
    # Usamos 'kill -9' para forzar la detención inmediata.
    kill -9 $pids
    log "-> Éxito: Proceso(s) en el puerto $port detenidos."
  else
    log "-> Info: No se encontró ningún servicio en el puerto $port."
  fi
}

# --- Ejecución Principal ---

log "Iniciando la detención de todos los servicios de la PoC..."
echo "--------------------------------------------------"

# 1. Detener el túnel de ngrok
# pkill -f es efectivo para ngrok, ya que el nombre del proceso es único.
log "Intentando detener 'Túnel de ngrok'..."
if pkill -f "ngrok http"; then
  log "-> Éxito: Proceso(s) de ngrok detenidos."
else
  log "-> Info: No se encontraron procesos de ngrok activos."
fi

# 2. Detener el proxy de autenticación
kill_by_port "$AUTH_PROXY_PORT" "Proxy de autenticación"

# 3. Detener el backend de FastAPI
kill_by_port "$PORT_BACKEND" "Backend de FastAPI"

# 4. Detener el servidor de desarrollo del frontend (Vite)
kill_by_port "$PORT_FRONTEND" "Frontend de Vite"

echo "--------------------------------------------------"
log "Proceso de detención completado."
echo

# Opcional: Preguntar si se quieren limpiar los logs
read -p "¿Deseas eliminar los archivos de log generados (*.log)? (s/n) " -n 1 -r
echo # Mover a la siguiente línea

if [[ $REPLY =~ ^[Ss]$ ]]; then
    ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    log "Eliminando archivos .log en $ROOT_DIR..."
    rm -f "$ROOT_DIR"/*.log
    log "Archivos de log eliminados."
fi

echo
log "¡Listo! Todos los servicios han sido detenidos."

