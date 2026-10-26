# Запуск на сервере

Панель работает на **https://app.saudabot.kz** на своём VPS, лендинг остаётся на Netlify
(**saudabot.kz**). Компьютер для работы панели больше не нужен.

```
Клиент WhatsApp ─► Meta ─► https://app.saudabot.kz/api/webhooks/whatsapp
                                   │
                    ┌──────────────┴──────────────── VPS ───────────────┐
                    │ Caddy (HTTPS, сертификат сам) ─► web (Next.js)     │
                    │                                   │                │
                    │ worker (ассистент, индексация) ◄─ Redis (очередь)  │
                    │        └──────────┬───────────────┘                │
                    │              Postgres + pgvector ─► backup (сутки) │
                    └────────────────────────────────────────────────────┘
```

Наружу открыты только порты 80 и 443 (Caddy) и SSH. База и Redis доступны только внутри сервера.

---

## 1. Какой сервер брать

| | Минимум | Рекомендую |
|---|---|---|
| Процессор | 1 vCPU | **2 vCPU** |
| Память | 2 ГБ | **4 ГБ** |
| Диск | 30 ГБ SSD | **40–60 ГБ SSD/NVMe** |
| Система | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

- На 1 ГБ памяти тоже заработает (скрипт добавит swap), но сборка будет идти 15+ минут,
  а под нагрузкой сервер будет тормозить.
- Расположение — Казахстан: короче путь до клиентов, а до Meta и Gemini задержка
  почти не меняется.
- В заказе выберите **Ubuntu 22.04** и, если предлагают, **вход по SSH-ключу**.
  Если ключа нет, подойдёт и пароль root: его выдаст хостинг.

## 2. DNS: направить app.saudabot.kz на сервер

В панели PS.kz → домен **saudabot.kz** → DNS-записи → добавить:

| Тип | Имя | Значение |
|---|---|---|
| A | `app` | IP вашего VPS |

Записи лендинга (Netlify) не трогайте. Запись расходится от 5 минут до часа.
Ждать не обязательно: скрипт поднимет сайт сразу, а HTTPS Caddy получит сам,
как только DNS заработает.

## 3. Одна команда на сервере

На Windows откройте PowerShell:

```powershell
ssh root@IP_СЕРВЕРА
```

(при первом входе спросит `yes/no` — напишите `yes`, затем пароль root)

На сервере:

```bash
curl -fsSL https://raw.githubusercontent.com/sarsengaliievn-cloud/simpleai/main/wa-saas-full/deploy/setup-server.sh | bash
```

Скрипт задаст три вопроса:
1. **Адрес панели** — Enter (по умолчанию `app.saudabot.kz`).
2. **Email** — для сертификата HTTPS. Let's Encrypt пишет туда только при проблемах.
3. **Ключ Gemini** — тот же, что в локальном `.env`. Ввод скрыт.

Дальше он сам обновит систему, включит файрвол и автообновления безопасности,
поставит Docker, скачает код, сгенерирует пароли и ключи, соберёт и запустит всё,
а потом сверит базу со схемой. Займёт 10–15 минут. В конце покажет адреса
и данные для Meta.

## 4. Первый вход

1. Откройте **https://app.saudabot.kz/register** и создайте свой аккаунт.
   Демо-данных на сервере нет: всё чистое.
2. **Ассистент** → включить, заполнить. **База знаний** → загрузить прайс и условия.
3. **Тестовый чат** → проверить ответы.

## 5. Обязательно сохранить

Файл `/opt/saudabot/wa-saas-full/.env.production` — все секреты сервера. Главное в нём —
**`ENCRYPTION_KEY`**: им зашифрованы токены WhatsApp клиентов. Потеряете ключ — все
клиенты будут подключать номера заново. Скопируйте файл в менеджер паролей:

```bash
cat /opt/saudabot/wa-saas-full/.env.production
```

## 6. Подключение Meta (когда дойдёт до живого WhatsApp)

В приложении Meta → WhatsApp → Configuration → Webhook:
- **Callback URL:** `https://app.saudabot.kz/api/webhooks/whatsapp`
- **Verify token:** значение `META_WEBHOOK_VERIFY_TOKEN` из `.env.production`

Затем впишите в `.env.production` значения `META_APP_ID`, `META_APP_SECRET` и
`META_CONFIG_ID` (после одобрения Tech Provider) и выполните `deploy/update.sh`.
С заданным `META_APP_SECRET` вебхук пускает только запросы с подписью Meta.

---

## Каждый день

**Обновить сервер после изменений в коде** (изменения уже в GitHub):

```bash
bash /opt/saudabot/wa-saas-full/deploy/update.sh
```

Скрипт сделает копию базы, соберёт новую версию, пока работает старая, применит
миграции и перезапустит. Если новая версия не поднимется, покажет логи.

**Поменять настройку** (ключ Gemini, Meta): `nano /opt/saudabot/wa-saas-full/.env.production`,
затем `update.sh`.

**Логи:**

```bash
cd /opt/saudabot/wa-saas-full
docker compose -f docker-compose.prod.yml logs -f --tail 100 web worker
```

**Состояние:** `docker compose -f docker-compose.prod.yml ps`
**Перезапуск:** `docker compose -f docker-compose.prod.yml --env-file .env.production restart web worker`

## Бэкапы

Копия базы делается раз в сутки в `/opt/saudabot/wa-saas-full/backups/`
и хранится 14 дней, плюс перед каждым `update.sh`. Эти копии лежат на том же
сервере, поэтому иногда забирайте их к себе (в PowerShell на ПК):

```powershell
scp root@IP_СЕРВЕРА:/opt/saudabot/wa-saas-full/backups/*.sql.gz .
```

Восстановление (затирает текущую базу!):

```bash
cd /opt/saudabot/wa-saas-full
docker compose -f docker-compose.prod.yml --env-file .env.production stop web worker
gunzip -c backups/ИМЯ_ФАЙЛА.sql.gz | docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres sh -c 'dropdb -U wa wa_saas && createdb -U wa wa_saas && psql -q -U wa wa_saas'
docker compose -f docker-compose.prod.yml --env-file .env.production start web worker
```

## Изменения схемы базы

Только так, на ПК:

```powershell
pnpm db:migrate --name что_меняем     # создаёт файл в packages/db/prisma/migrations
```

Файл миграции коммитится вместе с кодом, а на сервере его применит `update.sh`.
Править базу на сервере руками нельзя: следующее обновление на это наткнётся.

**Один раз на ПК** (база создавалась до появления миграций): при запущенном
Docker Desktop выполните `pnpm db:baseline`. Данные не трогаются.
