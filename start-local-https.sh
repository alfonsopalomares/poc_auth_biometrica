#!/usr/bin/env bash
#
# Levanta la PoC por HTTPS en la red local, para probarla desde un teléfono.
#
# Por qué HTTPS: getUserMedia (micrófono) y la Vibration API sólo funcionan en contextos
# seguros. `localhost` cuenta como seguro, pero `http://192.168.x.x` NO, así que desde el
# teléfono el factor de voz sería inusable sin TLS.
#
# A diferencia de start-tunnel.sh (ngrok), esto NO expone nada a internet: todo queda
# dentro de la red local.
#
# El móvil sólo habla con Vite; Vite hace de proxy de /api al backend por HTTP interno,
# así que no hay contenido mixto y el backend no necesita su propio certificado.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
SSL_DIR="$FRONTEND_DIR/ssl"
PORT_FRONTEND="5173"
PORT_BACKEND="8000"

log() { echo "[https-local] $*"; }

die() {
  echo "[https-local] ERROR: $*" >&2
  exit 1
}

detect_lan_ip() {
  local ip
  for iface in en0 en1 en2; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [[ -n "$ip" ]] && { echo "$ip"; return 0; }
  done
  return 1
}

# El certificado se regenera sólo si hace falta. La IP de la LAN cambia al saltar de red
# o cuando vence la asignación DHCP, y un certificado que no la incluya hace fallar el
# handshake en el teléfono con un error que no dice nada útil.
ensure_certificate() {
  local ip="$1"

  if [[ -f "$SSL_DIR/cert.pem" && -f "$SSL_DIR/key.pem" ]]; then
    local sans not_after
    sans="$(openssl x509 -in "$SSL_DIR/cert.pem" -noout -ext subjectAltName 2>/dev/null || true)"
    not_after="$(openssl x509 -in "$SSL_DIR/cert.pem" -noout -enddate 2>/dev/null | cut -d= -f2 || true)"

    if [[ "$sans" == *"$ip"* ]] && openssl x509 -in "$SSL_DIR/cert.pem" -noout -checkend 86400 >/dev/null 2>&1; then
      log "Certificado vigente y válido para $ip (vence: $not_after)"
      return 0
    fi

    if [[ "$sans" != *"$ip"* ]]; then
      log "El certificado no cubre $ip. Regenerando…"
    else
      log "El certificado venció o vence en menos de 24 h. Regenerando…"
    fi
  else
    log "No hay certificado. Generando uno nuevo…"
  fi

  mkdir -p "$SSL_DIR"

  # iOS 13+ exige SAN (ignora el CN), RSA de al menos 2048 bits y vigencia <= 825 días.
  cat >"$SSL_DIR/openssl.cnf" <<EOF
[req]
distinguished_name=req_distinguished_name
req_extensions=v3_req
prompt=no

[req_distinguished_name]
CN=PoC Auth Inclusiva

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
IP.3 = $ip
EOF

  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$SSL_DIR/key.pem" -out "$SSL_DIR/cert.pem" \
    -config "$SSL_DIR/openssl.cnf" -extensions v3_req >/dev/null 2>&1 ||
    die "openssl no pudo generar el certificado."

  chmod 600 "$SSL_DIR/key.pem"
  log "Certificado nuevo emitido para localhost, 127.0.0.1, ::1 y $ip"
}

port_pids() { lsof -ti:"$1" 2>/dev/null || true; }

free_port() {
  local port="$1" pids
  pids="$(port_pids "$port")"
  if [[ -n "$pids" ]]; then
    log "Liberando el puerto $port (PIDs: $(echo "$pids" | tr '\n' ' '))"
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 2
    pids="$(port_pids "$port")"
    [[ -n "$pids" ]] && echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

start_backend() {
  free_port "$PORT_BACKEND"
  log "Iniciando backend en 127.0.0.1:$PORT_BACKEND"
  (
    cd "$BACKEND_DIR"
    "$ROOT_DIR/.venv/bin/python" -m uvicorn app:app --host 127.0.0.1 --port "$PORT_BACKEND"
  ) >"$ROOT_DIR/backend.log" 2>&1 &

  # La primera carga levanta el modelo ECAPA-TDNN de SpeechBrain y no es instantánea.
  log "Esperando a que el backend responda…"
  for _ in $(seq 1 90); do
    if curl -sk -m 2 -o /dev/null "http://127.0.0.1:$PORT_BACKEND/api/users"; then
      log "Backend listo."
      return 0
    fi
    sleep 1
  done
  tail -n 20 "$ROOT_DIR/backend.log" >&2
  die "El backend no respondió. Revisá $ROOT_DIR/backend.log"
}

start_frontend() {
  free_port "$PORT_FRONTEND"
  log "Iniciando frontend con TLS en 0.0.0.0:$PORT_FRONTEND"
  (
    cd "$FRONTEND_DIR"
    VITE_USE_HTTPS=true npm run dev -- --port "$PORT_FRONTEND"
  ) >"$ROOT_DIR/frontend.log" 2>&1 &

  log "Esperando al servidor de desarrollo…"
  for _ in $(seq 1 60); do
    if curl -sk -m 2 -o /dev/null "https://127.0.0.1:$PORT_FRONTEND/"; then
      log "Frontend listo."
      return 0
    fi
    sleep 1
  done
  tail -n 20 "$ROOT_DIR/frontend.log" >&2
  die "El frontend no respondió. Revisá $ROOT_DIR/frontend.log"
}

main() {
  command -v openssl >/dev/null || die "Falta openssl."
  command -v npm >/dev/null || die "Falta npm."
  command -v lsof >/dev/null || die "Falta lsof."
  [[ -x "$ROOT_DIR/.venv/bin/python" ]] || die "No existe $ROOT_DIR/.venv/bin/python"
  [[ -d "$FRONTEND_DIR/node_modules" ]] || die "Faltan dependencias del frontend. Corré: npm --prefix frontend install"

  local ip
  ip="$(detect_lan_ip)" || die "No se pudo detectar la IP de la red local. ¿Estás conectado a wifi?"

  ensure_certificate "$ip"
  start_backend
  start_frontend

  cat <<EOF

────────────────────────────────────────────────────────────
  Abrí esta dirección en el teléfono (misma red wifi):

      https://$ip:$PORT_FRONTEND

  El certificado es autofirmado, así que el navegador va a
  advertir que la conexión no es privada. Es esperable:
  entrá en "Avanzado" / "Mostrar detalles" y elegí continuar.
  Sin aceptarlo el micrófono no funciona.

  En la Mac:  https://localhost:$PORT_FRONTEND
  Panel admin: http://127.0.0.1:$PORT_BACKEND/admin  (admin / admin)

  Logs:   $ROOT_DIR/backend.log
          $ROOT_DIR/frontend.log
  Frenar: $ROOT_DIR/stop-local-https.sh
────────────────────────────────────────────────────────────

EOF
}

main "$@"
