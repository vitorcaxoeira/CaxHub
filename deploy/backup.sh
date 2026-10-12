#!/usr/bin/env bash
# Backup do banco do CaxHub (pg_dump comprimido). Roda NA VPS, dentro de /opt/CaxHub.
#
#   bash deploy/backup.sh              # backup diário (o cron usa este)
#   bash deploy/backup.sh pre-deploy   # o motivo vira parte do nome do arquivo
#
# Arquivo: /opt/backups/caxhub-AAAAMMDD-HHMMSS-<motivo>.sql.gz
# Só entra na pasta um dump que passou na conferência (gzip íntegro + rodapé do pg_dump).
set -euo pipefail

cd "$(dirname "$0")/.."
MOTIVO="${1:-diario}"
MANTER_DIAS="${MANTER_DIAS:-14}"
PASTA="${PASTA:-/opt/backups}"

mkdir -p "$PASTA"
chmod 700 "$PASTA"
ARQ="$PASTA/caxhub-$(date +%Y%m%d-%H%M%S)-${MOTIVO}.sql.gz"
TMP="$ARQ.tmp"
trap 'rm -f "$TMP"' EXIT

# pipefail: se o pg_dump falhar, o script falha (sem ele, o gzip "teria sucesso" com arquivo vazio).
docker compose exec -T db pg_dump -U caxhub -d caxhub --no-owner </dev/null | gzip > "$TMP"

gzip -t "$TMP"
zcat "$TMP" | grep -q "PostgreSQL database dump complete" \
  || { echo "backup INVÁLIDO: sem o rodapé do pg_dump" >&2; exit 1; }

mv "$TMP" "$ARQ"
echo "backup ok: $ARQ ($(du -h "$ARQ" | cut -f1))"

# Retenção: apaga o que passou de MANTER_DIAS, mas nunca deixa a pasta com menos de 5 arquivos.
if [ "$(ls -1 "$PASTA"/caxhub-*.sql.gz | wc -l)" -gt 5 ]; then
  find "$PASTA" -name 'caxhub-*.sql.gz' -mtime "+$MANTER_DIAS" -delete
fi
