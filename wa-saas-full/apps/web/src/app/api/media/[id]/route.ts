import { requireCompany } from '@/lib/session';
import { numberAccessToken } from '@wa/core';
import { getProvider } from '@wa/whatsapp';
import { cacheMedia, readCachedMedia } from '@/lib/media-cache';

export const dynamic = 'force-dynamic';

/** Документы смотрим до 25 МБ — столько пропускает сервер; больше — открыть в WhatsApp. */
const MAX_VIEW_BYTES = 25 * 1024 * 1024;

/**
 * Вложение сообщения: фото, видео, голосовое, документ. Доступ — как к
 * самой переписке: менеджер видит только файлы своих клиентов.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, ownConversations } = await requireCompany();

  const message = await db.message.findFirst({
    where: { id, conversation: { ...ownConversations } },
    select: { id: true, metadata: true, mediaMimeType: true, type: true, conversation: { select: { phoneNumberId: true } } },
  });
  if (!message) return new Response('Не найдено', { status: 404 });

  const meta = (message.metadata ?? {}) as { mediaId?: string; fileName?: string };
  const download = new URL(request.url).searchParams.has('download');

  let file = await readCachedMedia(message.id);
  if (!file) {
    if (!meta.mediaId || !message.conversation.phoneNumberId) return new Response('Файл недоступен', { status: 404 });
    const token = await numberAccessToken(db, message.conversation.phoneNumberId);
    try {
      file = await getProvider().downloadMedia({ mediaId: meta.mediaId, accessToken: token, maxBytes: MAX_VIEW_BYTES });
    } catch (error) {
      console.error('[media] скачивание не удалось:', (error as Error).message);
      return new Response(`Файл недоступен: ${(error as Error).message}`, { status: 502 });
    }
    await cacheMedia(message.id, file.data, file.mimeType);
  }

  const name = meta.fileName ?? `${message.type.toLowerCase()}-${message.id.slice(0, 8)}`;
  return new Response(new Uint8Array(file.data), {
    headers: {
      'content-type': file.mimeType || message.mediaMimeType || 'application/octet-stream',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
      // Встраиваем только картинки, видео и звук; документы — всегда скачиванием,
      // чтобы присланный клиентом HTML не открылся внутри панели.
      'content-disposition': `${download || !/^(image|video|audio)\//.test(file.mimeType) ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
