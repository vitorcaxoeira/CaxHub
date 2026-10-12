#!/usr/bin/env bash
# Liga a exposição pública do CaxHub: o Traefik passa a rotear o domínio e emite o HTTPS.
# ANTES de ligar, confere por dois resolvedores públicos se o DNS já aponta para a VPS. Isso evita
# pedir certificado de um domínio que não resolve, o que o Let's Encrypt penaliza com limite de
# falhas por hora.
#
#   bash deploy/ativar-publico.sh            # liga
#   bash deploy/ativar-publico.sh desligar   # volta a deixar só em 127.0.0.1:8080
#
# Roda na máquina do Vitor. Variáveis opcionais: VPS (alias SSH; padrão soeltech-vps),
# DIR (pasta na VPS; padrão /opt/CaxHub), IP_VPS (IP público da VPS; se faltar, a VPS descobre).
set -euo pipefail

VPS="${VPS:-soeltech-vps}"
DIR="${DIR:-/opt/CaxHub}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 "$VPS")

aplicar() {
  "${SSH[@]}" "set -e; cd '$DIR'
    sed -i 's/^CAXHUB_PUBLICO=.*/CAXHUB_PUBLICO=$1/' .env
    docker compose up -d
    grep '^CAXHUB_PUBLICO=' .env" </dev/null
}

if [ "${1:-}" = "desligar" ]; then
  aplicar false
  echo "CaxHub voltou a ficar só em 127.0.0.1:8080"
  exit 0
fi

DOMINIO="$("${SSH[@]}" "grep '^CAXHUB_HOST=' '$DIR/.env' | cut -d= -f2-" </dev/null)"
[ -n "$DOMINIO" ] || { echo "CAXHUB_HOST não encontrado em $DIR/.env" >&2; exit 1; }
IP_VPS="${IP_VPS:-$("${SSH[@]}" "curl -s --max-time 8 https://api.ipify.org" </dev/null)}"
[[ "$IP_VPS" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "não consegui descobrir o IP da VPS; defina IP_VPS" >&2; exit 1; }

echo "==> conferindo o DNS de $DOMINIO por resolvedores públicos (é o que o Let's Encrypt enxerga)"
# Não usa o resolvedor local da VPS: o upstream da Hostinger segura respostas antigas por mais de
# uma hora e reprovaria um domínio que já resolve no mundo todo.
ok=1
for srv in 1.1.1.1 8.8.8.8; do
  ip="$("${SSH[@]}" "dig +short @$srv $DOMINIO A | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\$' | tail -1" </dev/null || true)"
  if [ "$ip" = "$IP_VPS" ]; then echo "  OK    @$srv  $DOMINIO -> $ip"; else echo "  FALTA @$srv  $DOMINIO -> ${ip:-sem registro A} (esperado $IP_VPS)"; ok=0; fi
done
if [ "$ok" != 1 ]; then
  echo
  echo "O DNS ainda não aponta para a VPS. Crie na Cloudflare (Somente DNS, nuvem cinza):"
  echo "    $DOMINIO   A   $IP_VPS"
  echo "Nada foi alterado."
  exit 1
fi

echo "==> ligando a exposição pública"
aplicar true
echo "==> o Traefik emite o certificado na primeira visita; acompanhe com:"
echo "    ssh $VPS 'docker logs --since 5m traefik 2>&1 | grep -i -E \"acme|caxhub\"'"
echo "    curl -I https://$DOMINIO"
