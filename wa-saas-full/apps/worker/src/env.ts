import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Обязан импортироваться ПЕРВЫМ в index.ts. В ESM все import поднимаются
 * наверх и выполняются до кода модуля, поэтому вызов config() прямо в
 * index.ts срабатывал уже после того, как redis.ts и @wa/db прочитали
 * process.env. Локально это маскировалось значениями по умолчанию
 * (localhost), а на сервере воркер ушёл бы не в тот Redis.
 *
 * Путь считается от файла, а не от текущей папки: воркер можно запускать
 * откуда угодно. Переменные, заданные окружением (Docker, systemd),
 * имеют приоритет над файлом.
 */
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });
