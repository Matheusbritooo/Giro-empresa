#!/usr/bin/env bash
# Sobe a demonstração do GIRO num contêiner só (Render). Se uma parte cair, o contêiner
# sai e o Render sobe tudo de novo.
set -euo pipefail

: "${GIRO_SEGREDO_JWT:?defina GIRO_SEGREDO_JWT}"
: "${GIRO_DATABASE_URL:?defina GIRO_DATABASE_URL}"
export PORT="${PORT:-10000}"

# Token da câmera do simulador: sai do segredo, então é igual a cada reinício e nunca público.
GIRO_TOKEN_CAMERA_DEMO="cam_$(printf '%s:camera-demo' "$GIRO_SEGREDO_JWT" | sha256sum | cut -c1-32)"
export GIRO_TOKEN_CAMERA_DEMO

# Painel e API ficam no endereço público que o Render dá ao serviço.
if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export GIRO_ORIGENS_CORS="[\"${RENDER_EXTERNAL_URL}\"]"
fi

esperar() {  # esperar PORTA: até alguém atender nela (no máximo 90 s)
  python - "$1" <<'PY'
import socket, sys, time
for _ in range(180):
    try:
        socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=1).close()
        sys.exit(0)
    except OSError:
        time.sleep(0.5)
sys.exit(f"nada respondeu na porta {sys.argv[1]}")
PY
}

cd /app
# O painel não depende do banco: sobe enquanto o banco é preparado.
(cd /web && HOSTNAME=127.0.0.1 PORT=3000 exec node server.js) &

# Migrações e dados num Python só (com 0,1 de CPU, cada Python que abre custa segundos).
# O Render dorme sem visitas: a cada vez que acorda, o salão começa do zero.
python - <<'PY'
from alembic import command
from alembic.config import Config

command.upgrade(Config("alembic.ini"), "head")

from giro.seed import semear

semear(zerar=True)
PY

uvicorn --factory giro.api.app:criar_app --host 127.0.0.1 --port 8000 \
  --proxy-headers --forwarded-allow-ips 127.0.0.1 &
esperar 8000
esperar 3000

# A porta pública abre por último: quem acorda o serviço não vê erro enquanto ele sobe.
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &

# Começa com 20 minutos de noite andando: salão com mesas esperando, ocupadas e para limpar.
python -m giro.simulador ao-vivo --aleatorio --ritmo demo --mesas 1-14 --minutos 120 \
  --inicio-em 20:00 --repetir --api http://127.0.0.1:8000 --token "$GIRO_TOKEN_CAMERA_DEMO" &

wait -n
exit 1
