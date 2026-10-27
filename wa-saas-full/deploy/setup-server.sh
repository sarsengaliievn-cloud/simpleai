#!/usr/bin/env bash
# Первая установка SaudaBot на чистый VPS (Ubuntu 22.04 / 24.04).
#
# Запуск на сервере под root, одной командой:
#   curl -fsSL https://raw.githubusercontent.com/sarsengaliievn-cloud/simpleai/main/wa-saas-full/deploy/setup-server.sh | bash
#
# Скрипт можно запускать повторно: уже сделанные шаги он пропускает,
# существующий .env.production не трогает.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/sarsengaliievn-cloud/simpleai.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/saudabot}"
APP_DIR="$INSTALL_DIR/wa-saas-full"

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }

# Вопросы задаём с терминала, даже если скрипт пришёл через curl | bash.
ask() {
  local prompt="$1" default="${2:-}" answer
  if [ -n "$default" ]; then prompt="$prompt [$default]"; fi
  read -r -p "$prompt: " answer < /dev/tty || true
  printf '%s' "${answer:-$default}"
}
ask_secret() {
  local answer
  read -r -s -p "$1: " answer < /dev/tty || true
  echo > /dev/tty
  printf '%s' "$answer"
}

[ "$(id -u)" -eq 0 ] || die "запустите от root (sudo -i)"
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || warn "скрипт проверен на Ubuntu, у вас ${PRETTY_NAME:-неизвестная ОС} — продолжаю"

# ── 1. Система ──────────────────────────────────────────────────
say "Обновляю систему"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq git curl ca-certificates ufw fail2ban unattended-upgrades openssl
# Автоматические обновления безопасности.
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
systemctl enable --now fail2ban >/dev/null 2>&1 || true

# ── 2. Swap ─────────────────────────────────────────────────────
# Сборка Next.js на сервере с 1–2 ГБ памяти без swap падает.
if ! swapon --show | grep -q .; then
  say "Создаю swap 2 ГБ"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

# ── 3. Docker ───────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  say "Устанавливаю Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null
docker compose version >/dev/null 2>&1 || die "не установился docker compose"

# ── 4. Файрвол ──────────────────────────────────────────────────
say "Настраиваю файрвол: открыты только SSH, 80 и 443"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

# ── 5. Код ──────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  say "Обновляю код в $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  say "Скачиваю код в $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$APP_DIR"

# ── 6. Настройки ────────────────────────────────────────────────
if [ ! -f .env.production ]; then
  say "Настройки (ответы можно поменять позже в $APP_DIR/.env.production)"
  DOMAIN=$(ask "Адрес панели" "app.saudabot.kz")
  ACME_EMAIL=""
  while [ -z "$ACME_EMAIL" ]; do
    ACME_EMAIL=$(ask "Email для HTTPS-сертификата (Let's Encrypt пишет только о проблемах с ним)")
  done
  GEMINI_API_KEY=$(ask_secret "Ключ Gemini API (ввод скрыт, можно пропустить и вписать позже)")
  # Ключ часто копируют из .env вместе с кавычками — они сломали бы файл настроек.
  GEMINI_API_KEY=$(printf '%s' "$GEMINI_API_KEY" | tr -d '"'"'"' \t\r\n')

  gen() { openssl rand -base64 32 | tr -d '\n'; }
  umask 077
  cat > .env.production <<ENV
# ── Создано setup-server.sh $(date +%F) ──
# Этот файл — единственное место с секретами. Права 600, в git не попадает.

DOMAIN="$DOMAIN"
ACME_EMAIL="$ACME_EMAIL"

# База. Пароль сгенерирован, наружу база не открыта.
POSTGRES_PASSWORD="$(openssl rand -hex 24)"

AUTH_SECRET="$(gen)"
# ВАЖНО: сохраните ENCRYPTION_KEY в надёжном месте (менеджер паролей).
# Им зашифрованы токены WhatsApp клиентов. Потеряете ключ — все клиенты
# должны будут подключать номера заново.
ENCRYPTION_KEY="$(gen)"

# Боевой WhatsApp. Пока номер не подключён в панели, отправлять просто некуда.
WHATSAPP_PROVIDER="cloud"
META_APP_ID=""
# Секрет приложения Meta (App settings → Basic → App secret). Без него
# вебхук в боевом режиме отклоняет все запросы — входящие не придут.
META_APP_SECRET=""
META_CONFIG_ID=""
META_WEBHOOK_VERIFY_TOKEN="$(openssl rand -hex 16)"

AI_PROVIDER="gemini"
GEMINI_API_KEY="$GEMINI_API_KEY"
AI_MODEL="gemini-3.6-flash"
AI_EMBED_MODEL="gemini-embedding-001"
GEMINI_BASE_URL=""

ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
ENV
  chmod 600 .env.production
else
  say "Найден .env.production — оставляю как есть"
fi

DOMAIN=$(grep -E '^DOMAIN=' .env.production | cut -d= -f2- | tr -d '"')

# ── 7. Проверка DNS ─────────────────────────────────────────────
SERVER_IP=$(curl -fsS -4 -m 10 https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "$DNS_IP" ]; then
  warn "Домен $DOMAIN указывает на '${DNS_IP:-никуда}', а IP сервера $SERVER_IP.
    Добавьте в DNS запись:  A  ${DOMAIN%%.*}  →  $SERVER_IP
    Сайт поднимется сразу, а HTTPS Caddy получит сам, как только запись разойдётся (обычно 5–30 минут)."
fi

# ── 8. Сборка и запуск ──────────────────────────────────────────
# </dev/null у exec и run обязателен: при запуске через `curl | bash` скрипт
# читается из stdin, и docker съел бы его остаток — установка молча оборвалась бы.
dc() { docker compose -f docker-compose.prod.yml --env-file .env.production "$@"; }

say "Собираю приложение (на маленьком сервере 5–10 минут)"
dc build
say "Запускаю"
dc up -d

say "Жду, пока панель поднимется"
for _ in $(seq 1 60); do
  if dc exec -T web node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null 2>/dev/null; then
    HEALTHY=1; break
  fi
  sleep 5
done
[ "${HEALTHY:-0}" = 1 ] || { dc ps; dc logs --tail 50 web migrate; die "панель не ответила за 5 минут — логи выше"; }

# ── 9. Сверка базы со схемой ────────────────────────────────────
say "Проверяю, что структура базы совпадает со схемой"
if dc run --rm --no-deps -T migrate node_modules/.bin/prisma migrate diff \
     --from-url "postgresql://wa:$(grep -E '^POSTGRES_PASSWORD=' .env.production | cut -d= -f2- | tr -d '"')@postgres:5432/wa_saas" \
     --to-schema-datamodel prisma/schema.prisma --exit-code </dev/null >/tmp/schema-diff.txt 2>&1; then
  echo "База совпадает со схемой."
else
  warn "База отличается от схемы — пришлите это разработчику:"; cat /tmp/schema-diff.txt
fi

VERIFY_TOKEN=$(grep -E '^META_WEBHOOK_VERIFY_TOKEN=' .env.production | cut -d= -f2- | tr -d '"')
say "Готово"
cat <<DONE

  Панель:          https://$DOMAIN
  Регистрация:     https://$DOMAIN/register
  Проверка:        https://$DOMAIN/api/health

  Для Meta (WhatsApp → Configuration → Webhook):
    Callback URL:  https://$DOMAIN/api/webhooks/whatsapp
    Verify token:  $VERIFY_TOKEN

  Настройки:       $APP_DIR/.env.production  (после правки: deploy/update.sh)
  Обновление:      bash $APP_DIR/deploy/update.sh
  Логи:            cd $APP_DIR && docker compose -f docker-compose.prod.yml logs -f web worker
  Бэкапы базы:     $APP_DIR/backups  (каждые сутки, хранятся 14 дней)

DONE
