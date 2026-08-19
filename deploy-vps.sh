#!/usr/bin/env bash
set -Eeuo pipefail

# One-command deployment for Debian/Ubuntu:
#   sudo bash deploy-vps.sh
# Optional non-interactive usage:
#   sudo WIDGET_DOMAIN=widget.example.com bash deploy-vps.sh

APP_NAME="bonus-buy-widget"
APP_DIR="/opt/${APP_NAME}"
STATE_DIR="/var/lib/${APP_NAME}"
ENV_DIR="/etc/${APP_NAME}"
ENV_FILE="${ENV_DIR}/widget.env"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
NGINX_FILE="/etc/nginx/sites-available/${APP_NAME}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}.conf"
APP_USER="${APP_NAME}"
APP_PORT="${WIDGET_PORT:-3000}"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || die "Запустите скрипт через sudo: sudo bash deploy-vps.sh"
command -v apt-get >/dev/null || die "Поддерживаются Debian и Ubuntu с apt."

detect_domain() {
  command -v nginx >/dev/null || return 0
  nginx -T 2>/dev/null |
    awk '
      /server_name[[:space:]]/ {
        for (i = 2; i <= NF; i++) {
          gsub(/;/, "", $i)
          if ($i != "_" && $i != "localhost" && $i !~ /^\*/ &&
              $i !~ /^widget\./ && $i ~ /\./ && $i !~ /^[0-9.]+$/) {
            print $i
            exit
          }
        }
      }'
}

say "Определение адреса виджета"
if [[ -z "${WIDGET_DOMAIN:-}" ]]; then
  EXISTING_DOMAIN="$(detect_domain || true)"
  if [[ -n "${EXISTING_DOMAIN}" ]]; then
    DEFAULT_DOMAIN="widget.${EXISTING_DOMAIN#www.}"
    if [[ -t 0 ]]; then
      read -r -p "Поддомен виджета [${DEFAULT_DOMAIN}]: " WIDGET_DOMAIN
      WIDGET_DOMAIN="${WIDGET_DOMAIN:-$DEFAULT_DOMAIN}"
    else
      WIDGET_DOMAIN="${DEFAULT_DOMAIN}"
    fi
  elif [[ -t 0 ]]; then
    read -r -p "Введите домен виджета (например widget.example.com): " WIDGET_DOMAIN
  else
    die "Домен не найден. Запустите с WIDGET_DOMAIN=widget.example.com."
  fi
fi

WIDGET_DOMAIN="${WIDGET_DOMAIN#http://}"
WIDGET_DOMAIN="${WIDGET_DOMAIN#https://}"
WIDGET_DOMAIN="${WIDGET_DOMAIN%%/*}"
[[ "${WIDGET_DOMAIN}" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] ||
  die "Некорректный домен: ${WIDGET_DOMAIN}"

say "Установка системных пакетов"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl nginx rsync openssl certbot python3-certbot-nginx

if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 18 ]]; then
  say "Установка Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

if ! command -v npm >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y npm
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "${NODE_MAJOR}" -ge 18 ]] || die "Требуется Node.js 18 или новее."

say "Установка приложения в ${APP_DIR}"
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi
install -d -o root -g root -m 0755 "${APP_DIR}"
rsync -a --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='server-test.log' \
  --exclude='server-test.err.log' \
  "${SOURCE_DIR}/" "${APP_DIR}/"
cd "${APP_DIR}"
npm install --omit=dev
npm run check

say "Создание постоянного хранилища и секретного токена"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${STATE_DIR}"
if [[ ! -f "${STATE_DIR}/state.json" ]]; then
  install -o "${APP_USER}" -g "${APP_USER}" -m 0640 \
    "${APP_DIR}/data/state.json" "${STATE_DIR}/state.json"
fi
install -d -o root -g root -m 0700 "${ENV_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  ADMIN_TOKEN="$(openssl rand -hex 32)"
  cat >"${ENV_FILE}" <<EOF
HOST=127.0.0.1
PORT=${APP_PORT}
ADMIN_TOKEN=${ADMIN_TOKEN}
DATA_FILE=${STATE_DIR}/state.json
EOF
  chmod 0600 "${ENV_FILE}"
fi

say "Настройка systemd"
cat >"${SERVICE_FILE}" <<EOF
[Unit]
Description=BonusBuy Widget
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${STATE_DIR}

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "${APP_NAME}"
systemctl restart "${APP_NAME}"

say "Настройка Nginx для ${WIDGET_DOMAIN}"
cat >"${NGINX_FILE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${WIDGET_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF
ln -sfn "${NGINX_FILE}" "${NGINX_LINK}"
nginx -t
systemctl reload nginx

say "Проверка приложения"
curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/api/state" >/dev/null

HTTPS_READY=false
if getent ahosts "${WIDGET_DOMAIN}" >/dev/null 2>&1; then
  say "DNS найден — подключение HTTPS"
  if certbot --nginx -d "${WIDGET_DOMAIN}" \
      --non-interactive --agree-tos --redirect --register-unsafely-without-email; then
    HTTPS_READY=true
  else
    printf '\nWARNING: Certbot не смог выпустить сертификат. Проверьте DNS и порты 80/443.\n' >&2
  fi
else
  printf '\nWARNING: DNS для %s ещё не найден. Создайте A-запись на IP VPS,\n' "${WIDGET_DOMAIN}" >&2
  printf 'затем выполните: sudo certbot --nginx -d %s\n' "${WIDGET_DOMAIN}" >&2
fi

ADMIN_TOKEN="$(sed -n 's/^ADMIN_TOKEN=//p' "${ENV_FILE}")"
SCHEME="http"
[[ "${HTTPS_READY}" == true ]] && SCHEME="https"

printf '\n============================================================\n'
printf 'Готово!\n'
printf 'Виджет:  %s://%s/\n' "${SCHEME}" "${WIDGET_DOMAIN}"
printf 'Админка: %s://%s/admin\n' "${SCHEME}" "${WIDGET_DOMAIN}"
printf 'Токен:   %s\n' "${ADMIN_TOKEN}"
printf 'Логи:    journalctl -u %s -f\n' "${APP_NAME}"
printf '============================================================\n'
