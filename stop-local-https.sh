#!/usr/bin/env bash
#
# Detiene el backend y el frontend levantados por start-local-https.sh.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[https-local] $*"; }

stop_port() {
  local port="$1" label="$2" pids
  pids="$(lsof -ti:"$port" 2>/dev/null || true)"

  if [[ -z "$pids" ]]; then
    log "$label (puerto $port): no había nada corriendo."
    return 0
  fi

  log "Deteniendo $label (puerto $port, PIDs: $(echo "$pids" | tr '\n' ' '))"
  echo "$pids" | xargs kill 2>/dev/null || true
  sleep 2

  pids="$(lsof -ti:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    log "No terminó por las buenas, forzando."
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

stop_port 5173 "frontend"
stop_port 8000 "backend"

log "Listo."
