'use server';

import { revalidatePath } from 'next/cache';
import { requireCompany } from '@/lib/session';
import { getProvider } from '@wa/whatsapp';
import { assertCanSendFreeText } from '@wa/core';

/**
 * Переключение режима диалога. Системное сообщение пишется только если
 * диалог действительно принадлежит компании: tenant-фильтр подставляет
 * companyId в create, но не проверяет, чей conversationId передали, —
 * без этой проверки можно было вписать строку в диалог другой компании.
 */
async function switchMode(conversationId: string, mode: 'AI' | 'HUMAN', note: string) {
  const { db, user } = await requireCompany();

  const { count } = await db.conversation.updateMany({
    where: { id: conversationId, mode: mode === 'AI' ? 'HUMAN' : 'AI' },
    data: { mode },
  });
  // 0 — чужой диалог, несуществующий id или режим уже такой (двойной клик).
  if (count === 0) return;

  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'SYSTEM',
      authorUserId: user.id,
      text: note,
      status: 'SENT',
      sentAt: new Date(),
    } as never,
  });

  revalidatePath('/conversations');
}

/** Менеджер забирает диалог: ассистент перестаёт отвечать автоматически. */
export async function takeOver(conversationId: string) {
  await switchMode(conversationId, 'HUMAN', 'Менеджер забрал диалог — ассистент больше не отвечает автоматически');
}

export async function returnToAi(conversationId: string) {
  await switchMode(conversationId, 'AI', 'Диалог возвращён ассистенту');
}

/**
 * Отправка сообщения менеджером. Порядок важен: сначала проверка окна,
 * потом провайдер, и только потом запись в базу с реальным ID сообщения.
 */
export async function sendMessage(conversationId: string, text: string) {
  const body = text.trim();
  if (!body) return { ok: false as const, error: 'Пустое сообщение' };
  if (body.length > 4096) return { ok: false as const, error: 'WhatsApp принимает до 4096 символов' };

  const { db, user } = await requireCompany();

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    include: { customer: true, phoneNumber: true },
  });
  if (!conversation) return { ok: false as const, error: 'Диалог не найден' };

  try {
    assertCanSendFreeText(conversation.windowExpiresAt);
  } catch (error) {
    return { ok: false as const, error: (error as Error).message };
  }

  if (!conversation.phoneNumber || conversation.phoneNumber.status === 'DISCONNECTED') {
    return { ok: false as const, error: 'К диалогу не привязан активный номер WhatsApp' };
  }

  let providerMessageId: string;
  try {
    const result = await getProvider().sendText({
      phoneNumberId: conversation.phoneNumber.phoneNumberId,
      to: conversation.customer.waId,
      text: body,
    });
    providerMessageId = result.providerMessageId;
  } catch (error) {
    console.error('[send] провайдер вернул ошибку', error);
    return { ok: false as const, error: 'Не удалось отправить сообщение. Попробуйте ещё раз.' };
  }

  const now = new Date();
  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'MANAGER',
      authorUserId: user.id,
      type: 'TEXT',
      text: body,
      providerMessageId,
      status: 'SENT',
      sentAt: now,
    } as never,
  });
  await db.conversation.updateMany({
    where: { id: conversationId },
    data: { lastMessageAt: now, unreadCount: 0 },
  });

  revalidatePath('/conversations');
  return { ok: true as const };
}

/** Отметить прочитанным при открытии диалога. */
export async function markRead(conversationId: string) {
  const { db } = await requireCompany();
  const { count } = await db.conversation.updateMany({
    where: { id: conversationId, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  });
  // Без лишней перерисовки, если читать было нечего.
  if (count > 0) revalidatePath('/conversations');
}
