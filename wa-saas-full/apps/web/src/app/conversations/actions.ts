'use server';

import { revalidatePath } from 'next/cache';
import { requireCompany } from '@/lib/session';
import { getProvider } from '@wa/whatsapp';
import { assertCanSendFreeText } from '@wa/core';

/** Менеджер забирает диалог: ассистент перестаёт отвечать автоматически. */
export async function takeOver(conversationId: string) {
  const { db } = await requireCompany();

  await db.conversation.updateMany({
    where: { id: conversationId },
    data: { mode: 'HUMAN' },
  });
  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'SYSTEM',
      text: 'Менеджер забрал диалог — ассистент больше не отвечает автоматически',
      status: 'SENT',
      sentAt: new Date(),
    } as never,
  });

  revalidatePath('/conversations');
}

export async function returnToAi(conversationId: string) {
  const { db } = await requireCompany();

  await db.conversation.updateMany({
    where: { id: conversationId },
    data: { mode: 'AI' },
  });
  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'SYSTEM',
      text: 'Диалог возвращён ассистенту',
      status: 'SENT',
      sentAt: new Date(),
    } as never,
  });

  revalidatePath('/conversations');
}

/**
 * Отправка сообщения менеджером. Порядок важен: сначала проверка окна,
 * потом провайдер, и только потом запись в базу с реальным ID сообщения.
 */
export async function sendMessage(conversationId: string, text: string) {
  const body = text.trim();
  if (!body) return { ok: false as const, error: 'Пустое сообщение' };

  const { db } = await requireCompany();

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

  if (!conversation.phoneNumber) {
    return { ok: false as const, error: 'К диалогу не привязан номер WhatsApp' };
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
  await db.conversation.updateMany({ where: { id: conversationId }, data: { unreadCount: 0 } });
  revalidatePath('/conversations');
}
