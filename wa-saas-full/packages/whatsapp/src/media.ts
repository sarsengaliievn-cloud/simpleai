/**
 * Скачивание вложения из WhatsApp Cloud API в два шага:
 * 1) GET /{media-id} → временная ссылка (живёт ~5 минут);
 * 2) GET по ссылке с тем же токеном → сам файл.
 *
 * Токен — системного пользователя WABA этой компании (whatsapp_accounts.accessToken).
 */
import { graphBase } from './graph.js';

/** Лимит WhatsApp на аудио и видео — 16 МБ. Больше не качаем. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export type DownloadedMedia = { data: Buffer; mimeType: string };

export async function downloadCloudMedia(mediaId: string, accessToken: string): Promise<DownloadedMedia> {
  if (!/^\d+$/.test(mediaId)) throw new Error('Некорректный media id');

  const meta = await fetch(`${graphBase()}/${mediaId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!meta.ok) throw new Error(`Meta (media) вернула ${meta.status}: ${(await meta.text()).slice(0, 300)}`);

  const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!info.url) throw new Error('Meta не вернула ссылку на файл');
  if ((info.file_size ?? 0) > MAX_MEDIA_BYTES) throw new Error('Файл больше 16 МБ');

  const file = await fetch(info.url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!file.ok) throw new Error(`Скачивание файла: ${file.status}`);

  const data = Buffer.from(await file.arrayBuffer());
  if (data.length > MAX_MEDIA_BYTES) throw new Error('Файл больше 16 МБ');

  return { data, mimeType: info.mime_type ?? file.headers.get('content-type') ?? 'application/octet-stream' };
}
