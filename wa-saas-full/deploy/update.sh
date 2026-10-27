#!/usr/bin/env bash
# Обновление на сервере: свежий код из GitHub → сборка → миграции → перезапуск.
#   bash /opt/saudabot/wa-saas-full/deploy/update.sh
#
# Перед миграциями делается резервная копия базы.

set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
dc()   { docker compose -f docker-compose.prod.yml --env-file .env.production "$@"; }

[ -f .env.production ] || die "нет .env.production — сначала deploy/setup-server.sh"

say "Забираю код"
git pull --ff-only

say "Собираю (сайт пока работает на старой версии)"
dc build

say "Резервная копия базы перед миграциями"
mkdir -p backups
dc exec -T postgres pg_dump -U wa wa_saas | gzip > "backups/before-update-$(date +%F_%H%M).sql.gz"

say "Перезапускаю: миграции применятся автоматически"
dc up -d --remove-orphans

for _ in $(seq 1 60); do
  if dc exec -T web node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null 2>/dev/null; then
    HEALTHY=1; break
  fi
  sleep 5
done
[ "${HEALTHY:-0}" = 1 ] || { dc ps; dc logs --tail 80 migrate web; die "панель не поднялась — логи выше. Копия базы в backups/before-update-*"; }

docker image prune -f >/dev/null
dc ps
say "Обновлено"
