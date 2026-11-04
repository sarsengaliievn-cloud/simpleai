import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Вложения переписки кэшируются на диске сервера: Meta отдаёт файл по
 * временной ссылке, и без кэша каждый просмотр фото шёл бы в Meta заново.
 * Кэш не обязателен — если файла нет, он скачивается снова.
 */
const DIR = process.env.MEDIA_CACHE_DIR || join(tmpdir(), 'saudabot-media');

const safe = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, '');

export async function readCachedMedia(messageId: string): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const base = join(DIR, safe(messageId));
    await stat(base);
    const [data, mimeType] = await Promise.all([readFile(base), readFile(`${base}.type`, 'utf8')]);
    return { data, mimeType };
  } catch {
    return null;
  }
}

export async function cacheMedia(messageId: string, data: Buffer, mimeType: string) {
  try {
    await mkdir(DIR, { recursive: true });
    const base = join(DIR, safe(messageId));
    await writeFile(base, data);
    await writeFile(`${base}.type`, mimeType);
  } catch (error) {
    console.error('[media] не удалось сохранить в кэш:', (error as Error).message);
  }
}
