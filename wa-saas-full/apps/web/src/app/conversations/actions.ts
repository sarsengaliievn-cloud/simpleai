'use server';

import { revalidatePath } from 'next/cache';
import { requireCompany } from '@/lib/session';
import { assertCanSendFreeText, sendWhatsAppText, markWhatsAppRead, sendErrorText, closeConversation, reopenConversation, parseAmount, CrmError, CLOSE_OUTCOMES, type CloseOutcome, sendWhatsAppTemplate, renderTemplate, NAME_VARIABLE } from '@wa/core';

/**
 * Переключение режима диалога. Системное сообщение пишется только если
 * диалог действительно принадлежит компании: tenant-фильтр подставляет
 * companyId в create, но не проверяет, чей conversationId передали, —
 * без этой проверки можно было вписать строку в диалог другой компании.
 */
async function switchMode(conversationId: string, mode: 'AI' | 'HUMAN', note: string) {
  const { db, user, ownConversations } = await requireCompany();

  const { count } = await db.conversation.updateMany({
    where: { id: conversationId, mode: mode === 'AI' ? 'HUMAN' : 'AI', ...ownConversations },
    data: { mode },
  });
  // 0 — чужой диалог, несуществующий id или режим уже такой (двойной клик).
  if (count === 0) return;

  // Забрал диалог — он и ведёт клиента, если ещё никому не передан.
  if (mode === 'HUMAN') {
    await db.conversation.updateMany({ where: { id: conversationId, assigneeId: null }, data: { assigneeId: user.id } });
  }

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
  revalidatePath('/deals');
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

  const { db, user, ownConversations } = await requireCompany();

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, ...ownConversations },
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
    const result = await sendWhatsAppText(db, {
      phoneNumberRowId: conversation.phoneNumber.id,
      to: conversation.customer.waId,
      text: body,
      retries: 1,
    });
    providerMessageId = result.providerMessageId;
  } catch (error) {
    console.error('[send] WhatsApp не принял сообщение:', (error as Error).message);
    // Текст причины — от Meta, переведённый: окно 24 часа, истёкший токен и т.п.
    return { ok: false as const, error: sendErrorText(error) };
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
  // Написали в закрытый диалог — значит, работа с клиентом снова идёт.
  if (conversation.status === 'CLOSED') await reopenConversation(db, conversationId, { actorName: user.firstName });

  revalidatePath('/conversations');
  revalidatePath('/deals');
  return { ok: true as const };
}

/**
 * Шаблон — когда клиент молчит больше 24 часов. Имя подставляется само,
 * остальные поля (трек-номер) вписывает менеджер.
 */
export async function sendTemplateAction(conversationId: string, templateId: string, values: Record<string, string>) {
  const { db, user, ownConversations } = await requireCompany();
  const [conversation, template] = await Promise.all([
    db.conversation.findFirst({ where: { id: conversationId, ...ownConversations }, include: { customer: true, phoneNumber: true } }),
    db.messageTemplate.findFirst({ where: { id: templateId } }),
  ]);
  if (!conversation) return { ok: false as const, error: 'Диалог не найден' };
  if (!template || template.status !== 'APPROVED') return { ok: false as const, error: 'Этот шаблон ещё не одобрен Meta' };
  if (!conversation.phoneNumber || conversation.phoneNumber.status === 'DISCONNECTED') {
    return { ok: false as const, error: 'К диалогу не привязан активный номер WhatsApp' };
  }
  if (template.accountId !== conversation.phoneNumber.accountId) {
    return { ok: false as const, error: 'Этот шаблон создан для другого номера WhatsApp' };
  }

  const variables: string[] = [];
  for (const label of template.variables) {
    // Meta не принимает пустое поле, переносы строк и табуляцию в значениях.
    const raw = label === NAME_VARIABLE
      ? (values[label]?.trim() || conversation.customer.name?.trim() || 'уважаемый клиент')
      : (values[label] ?? '').trim();
    const value = raw.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 200);
    if (!value) return { ok: false as const, error: `Заполните поле «${label}»` };
    variables.push(value);
  }

  let providerMessageId: string;
  try {
    const result = await sendWhatsAppTemplate(db, {
      phoneNumberRowId: conversation.phoneNumber.id,
      to: conversation.customer.waId,
      templateName: template.name,
      languageCode: template.language,
      variables,
    });
    providerMessageId = result.providerMessageId;
  } catch (error) {
    console.error('[send] шаблон не принят:', (error as Error).message);
    return { ok: false as const, error: sendErrorText(error) };
  }

  const now = new Date();
  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'MANAGER',
      authorUserId: user.id,
      type: 'TEMPLATE',
      text: renderTemplate(template.body, variables),
      providerMessageId,
      status: 'SENT',
      sentAt: now,
      metadata: { template: template.name, templateTitle: template.title },
    } as never,
  });
  await db.conversation.updateMany({ where: { id: conversationId }, data: { lastMessageAt: now, unreadCount: 0 } });
  if (conversation.status === 'CLOSED') await reopenConversation(db, conversationId, { actorName: user.firstName });

  revalidatePath('/conversations');
  revalidatePath('/deals');
  return { ok: true as const };
}

/** Отметить прочитанным при открытии диалога. */
export async function markRead(conversationId: string) {
  const { db, ownConversations } = await requireCompany();
  const { count } = await db.conversation.updateMany({
    where: { id: conversationId, unreadCount: { gt: 0 }, ...ownConversations },
    data: { unreadCount: 0 },
  });
  // Без лишней перерисовки, если читать было нечего.
  if (count === 0) return;

  // Клиенту — синие галочки: менеджер открыл переписку.
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    select: {
      phoneNumberId: true,
      messages: {
        where: { direction: 'INBOUND', providerMessageId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { providerMessageId: true },
      },
    },
  });
  const last = conversation?.messages[0]?.providerMessageId;
  if (conversation?.phoneNumberId && last) {
    await markWhatsAppRead(db, { phoneNumberRowId: conversation.phoneNumberId, providerMessageId: last });
  }

  revalidatePath('/conversations');
  revalidatePath('/deals');
}

export type CloseResult = { ok: true } | { ok: false; error: string };

/**
 * Закрыть диалог с итогом: просто вопрос, купил, отказ, спам. Закрыть может
 * любой, кто видит диалог: менеджер — свои, владелец — все.
 */
export async function closeConversationAction(
  conversationId: string,
  outcome: CloseOutcome,
  extra: { lostReason?: string; amount?: string; product?: string } = {},
): Promise<CloseResult> {
  const { db, user, ownConversations } = await requireCompany();
  if (!CLOSE_OUTCOMES.includes(outcome)) return { ok: false, error: 'Неизвестный итог' };
  const visible = await db.conversation.findFirst({ where: { id: conversationId, ...ownConversations }, select: { id: true } });
  if (!visible) return { ok: false, error: 'Диалог не найден' };
  try {
    await closeConversation(db, {
      conversationId,
      outcome,
      actorUserId: user.id,
      actorName: `${user.firstName} ${user.lastName}`.trim(),
      lostReason: extra.lostReason?.trim().slice(0, 120) || null,
      amount: extra.amount ? parseAmount(extra.amount) : null,
      product: extra.product?.trim().slice(0, 300) || null,
    });
  } catch (error) {
    return { ok: false, error: error instanceof CrmError ? error.message : 'Не удалось закрыть диалог' };
  }
  revalidatePath('/conversations');
  revalidatePath('/deals');
  return { ok: true };
}

/** Открыть закрытый диалог снова. */
export async function reopenConversationAction(conversationId: string): Promise<CloseResult> {
  const { db, user, ownConversations } = await requireCompany();
  const visible = await db.conversation.findFirst({ where: { id: conversationId, ...ownConversations }, select: { id: true } });
  if (!visible) return { ok: false, error: 'Диалог не найден' };
  await reopenConversation(db, conversationId, { actorName: `${user.firstName} ${user.lastName}`.trim() });
  revalidatePath('/conversations');
  revalidatePath('/deals');
  return { ok: true };
}
