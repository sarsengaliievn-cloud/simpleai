# Установка с нуля или обновление

## Если проект уже стоит

1. Сохрани свой `.env` — распаковка его не тронет, но на всякий случай скопируй.
2. Распакуй архив поверх `C:\projects\wa-saas` с заменой.
3. Удали файлы, оставшиеся от ручных правок, если создавал их сам:
   `Remove-Item packages\core\src\ai\gemin.ts -ErrorAction SilentlyContinue`
4. `pnpm install`
5. `pnpm dev`

Миграции и `vector.sql` заново запускать не нужно — база не менялась.

## С нуля

```powershell
cd C:\projects\wa-saas
Copy-Item .env.example .env
notepad .env                # вписать GEMINI_API_KEY
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate --name init
docker compose cp packages\db\sql\vector.sql postgres:/tmp/vector.sql
docker compose exec postgres psql -U wa -d wa_saas -f /tmp/vector.sql
pnpm db:seed
pnpm dev
```

## Что должно быть в .env для Gemini

```
AI_PROVIDER="gemini"
GEMINI_API_KEY="ключ"
AI_MODEL="gemini-2.5-flash"
AI_EMBED_MODEL="gemini-embedding-001"
```

## Рабочие адреса

| Адрес | Что там |
|---|---|
| `/` | лендинг |
| `/conversations` | инбокс: переписка, перехват диалога, отправка |
| `/customers` | клиенты, создаются автоматически |
| `/assistant` | роль, тон, языки, запреты, порог уверенности |
| `/knowledge` | документы, ручные заметки, проверка поиска |
| `/playground` | тестовый чат, в WhatsApp ничего не уходит |
| `/whatsapp` | номера и ручное подключение |
| `/analytics` | цифры из базы за 14 дней |
| `/settings` | компания и журнал действий |

## Порядок первой проверки

1. `/assistant` — заполнить и сохранить.
2. `/knowledge` → «Своими словами» → абзац про доставку → дождаться статуса «Готов».
   Дошло до «Готов» — значит Gemini отвечает и эмбеддинги считаются.
3. Там же справа «Проверка поиска» — видно найденные фрагменты и их score.
4. `/playground` — вопросы как от клиента.

Если на шаге 2 статус стал «Ошибка» — текст ошибки виден прямо в таблице документов.
