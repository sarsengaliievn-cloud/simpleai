import { requireCompany } from '@/lib/session';
import { assertCanSendFreeText, sendWhatsAppMedia, sendErrorText } from '@wa/core';
import { cacheMedia } from '@/lib/media-cache';

export const dynamic = 'force-dynamic';

/** Лимиты WhatsApp: фото JPG/PNG до 5 МБ, видео MP4/3GP до 16 МБ; документы — до 25 МБ (столько пропускает сервер). */
const IMAGE = new Set(['image/jpeg', 'image/png']);
const VIDEO = new Set(['video/mp4', 'video/3gpp']);
const MB = 1024 * 1024;

function classify(mime: string, size: number): { kind: 'image' | 'video' | 'document'; error?: string } {
  if (IMAGE.has(mime)) return size > 5 * MB ? { kind: 'image', error: 'Фото больше 5 МБ — WhatsApp не примет. Сожмите или отправьте файлом.' } : { kind: 'image' };
  if (VIDEO.has(mime)) return size > 16 * MB ? { kind: 'video', error: 'Видео больше 16 МБ — WhatsApp не примет. Обрежьте или сожмите его.' } : { kind: 'video' };
  return size > 25 * MB ? { kind: 'document', error: 'Файл больше 25 МБ.' } : { kind: 'document' };
}

/** Менеджер отправляет фото, видео или файл клиенту. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, user, ownConversations } = await requireCompany();

  const conversation = await db.conversation.findFirst({
    where: { id, ...ownConversations },
    include: { customer: true, phoneNumber: true },
  });
  if (!conversation) return Response.json({ error: 'Диалог не найден' }, { status: 404 });

  try {
    assertCanSendFreeText(conversation.windowExpiresAt);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  if (!conversation.phoneNumber || conversation.phoneNumber.status === 'DISCONNECTED') {
    return Response.json({ error: 'К диалогу не привязан активный номер WhatsApp' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Файл не дошёл — возможно, он слишком большой' }, { status: 400 });
  }
  const file = form.get('file');
  const caption = String(form.get('caption') ?? '').trim().slice(0, 1024);
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: 'Выберите файл' }, { status: 400 });

  const mimeType = file.type || 'application/octet-stream';
  const { kind, error } = classify(mimeType, file.size);
  if (error) return Response.json({ error }, { status: 400 });

  const data = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.replace(/[\r\n"]/g, '').slice(0, 200) || 'file';

  let sent: { providerMessageId: string; mediaId: string };
  try {
    sent = await sendWhatsAppMedia(db, {
      phoneNumberRowId: conversation.phoneNumber.id,
      to: conversation.customer.waId,
      kind,
      data,
      mimeType,
      fileName,
      caption: caption || undefined,
    });
  } catch (err) {
    console.error('[send-media] WhatsApp не принял файл:', (err as Error).message);
    return Response.json({ error: sendErrorText(err) }, { status: 502 });
  }

  const now = new Date();
  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      authorType: 'MANAGER',
      authorUserId: user.id,
      type: kind.toUpperCase(),
      text: caption || null,
      mediaMimeType: mimeType,
      providerMessageId: sent.providerMessageId,
      status: 'SENT',
      sentAt: now,
      metadata: { mediaId: sent.mediaId, fileName },
    } as never,
    select: { id: true },
  });
  await cacheMedia(message.id, data, mimeType);
  await db.conversation.updateMany({ where: { id: conversation.id }, data: { lastMessageAt: now, unreadCount: 0 } });

  return Response.json({ ok: true, id: message.id });
}
