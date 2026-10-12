#!/usr/bin/env bash
# Instala ou atualiza o EscalaBus num servidor Linux (Debian/Ubuntu ou Fedora/RHEL),
# com HTTPS pela rede Tailscale (tailscale serve). Pode ser executado de novo para atualizar.
#
#   curl -fsSL https://raw.githubusercontent.com/Edsontj2/Conferencia-/BRANCH/escalabus/deploy/instalar.sh -o instalar.sh
#   sudo bash instalar.sh
set -euo pipefail

REPO="${REPO:-https://github.com/Edsontj2/Conferencia-.git}"
BRANCH="${BRANCH:-claude/escalabus-scheduling-app-ccewkb}"
SRC=/opt/escalabus
APP="$SRC/escalabus"
DATA=/var/lib/escalabus
ENVFILE=/etc/escalabus.env
PORT="${PORT:-3000}"
SVC_USER=escalabus

# Executa um comando como o usuário do serviço
as_app() { runuser -u "$SVC_USER" -- env HOME="$DATA" "$@"; }
msg() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Execute com sudo: sudo bash instalar.sh"
[ -d /run/systemd/system ] || die "Este script precisa de systemd."

msg "Instalando dependências do sistema"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates python3 make g++ >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q git curl ca-certificates python3 make gcc-c++
else
  die "Gerenciador de pacotes não suportado (use Debian/Ubuntu ou Fedora/RHEL)."
fi

NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  msg "Instalando Node.js 22"
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null
    dnf install -y -q nodejs
  fi
fi
echo "Node.js $(node -v)"

id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$DATA"
chown -R "$SVC_USER:$SVC_USER" "$DATA"
chmod 750 "$DATA"

msg "Baixando o código ($BRANCH)"
if [ -d "$SRC/.git" ]; then
  as_app git -C "$SRC" fetch -q origin "$BRANCH"
  as_app git -C "$SRC" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$SRC"
fi
chown -R "$SVC_USER:$SVC_USER" "$SRC"

msg "Instalando pacotes e compilando (pode levar alguns minutos)"
cd "$APP"
as_app npm ci --no-audit --no-fund --loglevel=error
as_app npm run build --silent

# HTTPS via Tailscale, se disponível
TS_NAME=""
if command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then
  TS_NAME="$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=(JSON.parse(s).Self||{}).DNSName||"";console.log(n.replace(/\.$/,""))})')"
fi
if [ -n "$TS_NAME" ]; then BIND=127.0.0.1; SECURE=true; else BIND=0.0.0.0; SECURE=; fi

if [ ! -f "$ENVFILE" ]; then
  cat > "$ENVFILE" <<CFG
HOST=$BIND
PORT=$PORT
DATA_DIR=$DATA
COOKIE_SECURE=$SECURE
# Para usar o Supabase em vez do banco local, preencha:
DATABASE_URL=
CFG
  chmod 640 "$ENVFILE"
  chown root:"$SVC_USER" "$ENVFILE"
fi

msg "Aplicando migrações do banco"
( set -a; . "$ENVFILE"; set +a; cd "$APP"; as_app env DATA_DIR="$DATA" DATABASE_URL="${DATABASE_URL:-}" npm run --silent migrate )

HAS_ADMIN="$(set -a; . "$ENVFILE"; set +a; cd "$APP" && as_app env DATA_DIR="$DATA" DATABASE_URL="${DATABASE_URL:-}" SEED_REAL_DATA=false node_modules/.bin/tsx server/cli.ts has-admin | tail -1)"
if [ "$HAS_ADMIN" = "0" ]; then
  msg "Criando o administrador do EscalaBus"
  read -r -p "Usuário [admin]: " ADM_USER </dev/tty; ADM_USER="${ADM_USER:-admin}"
  while true; do
    read -r -s -p "Senha (mín. 8 caracteres): " ADM_PW </dev/tty; echo
    read -r -s -p "Repita a senha: " ADM_PW2 </dev/tty; echo
    [ "${#ADM_PW}" -ge 8 ] && [ "$ADM_PW" = "$ADM_PW2" ] && break
    echo "Senhas diferentes ou curtas demais. Tente de novo."
  done
  ( set -a; . "$ENVFILE"; set +a; cd "$APP"; as_app env DATA_DIR="$DATA" DATABASE_URL="${DATABASE_URL:-}" ADMIN_USERNAME="$ADM_USER" ADMIN_PASSWORD="$ADM_PW" \
      node_modules/.bin/tsx server/cli.ts create-admin --env )
  unset ADM_PW ADM_PW2
fi

msg "Configurando o serviço (inicia sozinho com o servidor)"
cat > /etc/systemd/system/escalabus.service <<UNIT
[Unit]
Description=EscalaBus
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$APP
EnvironmentFile=$ENVFILE
Environment=NODE_ENV=production
ExecStart=$APP/node_modules/.bin/tsx server/index.ts
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now escalabus >/dev/null
systemctl restart escalabus

for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || die "O serviço não respondeu. Veja: journalctl -u escalabus -n 50"

if [ -n "$TS_NAME" ]; then
  msg "Publicando com HTTPS na rede Tailscale"
  if ! tailscale serve --bg "$PORT" >/dev/null 2>&1; then
    tailscale serve https / "http://127.0.0.1:$PORT" >/dev/null 2>&1 || true
  fi
  URL="https://$TS_NAME"
else
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  URL="http://$IP:$PORT"
fi

msg "Pronto!"
cat <<FIM
EscalaBus rodando em: $URL

Abra esse endereço em qualquer aparelho conectado ao Tailscale.
FIM
if [ -n "$TS_NAME" ]; then cat <<FIM
Se o endereço https não abrir, ative no painel do Tailscale (login.tailscale.com/admin/dns):
  "MagicDNS" e "HTTPS Certificates". Depois rode de novo: sudo tailscale serve --bg $PORT
O primeiro acesso por https pode demorar alguns segundos (emissão do certificado).
FIM
else cat <<FIM
Tailscale não foi encontrado neste servidor: o acesso ficou por http, sem instalação
como app nem modo offline. Instale o Tailscale e rode este script de novo para ter https.
FIM
fi
cat <<FIM

Comandos úteis:
  sudo systemctl status escalabus      # situação
  sudo journalctl -u escalabus -f      # registros
  sudo bash instalar.sh                # atualizar para a versão mais nova
Dados (banco local): $DATA  (faça backup desta pasta)
FIM
