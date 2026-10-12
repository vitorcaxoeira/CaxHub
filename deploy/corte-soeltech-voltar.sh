#!/usr/bin/env bash
# Reversão do corte (vale nas primeiras horas): a VPS nova sai do ar e a antiga volta como estava.
# O que tiver sido gravado na VPS nova depois do corte NÃO volta para a antiga.
set -euo pipefail
export PATH="/c/Windows/System32/OpenSSH:$PATH"
cd "$(dirname "$0")/.."
OLD=(ssh -o BatchMode=yes -i "$HOME/.ssh/caxhub_vps_ed25519" -o IdentitiesOnly=yes root@179.197.67.226)
NEW=(ssh -o BatchMode=yes soeltech-vps)

echo "==> VPS nova: desliga o público e para o backend (nada mais grava nem envia ao Senior)"
VPS=soeltech-vps bash deploy/ativar-publico.sh desligar
"${NEW[@]}" 'cd /opt/CaxHub && docker compose stop backend' </dev/null

echo "==> VPS antiga: tira o redirecionamento e religa o CaxHub"
"${OLD[@]}" 'if [ -d /opt/caxhub-redirect ]; then cd /opt/caxhub-redirect && docker compose down; fi
cd /opt/CaxHub && docker compose start && docker compose ps --format "{{.Name}} {{.Status}}"' </dev/null
for i in $(seq 1 30); do
  c=$(curl -s -o /dev/null -w "%{http_code}" http://179.197.67.226:8080/api/dashboard/ping || true)
  [ "$c" = 401 ] && break; sleep 3
done
echo "antiga ping=$c (401 = de volta)"
