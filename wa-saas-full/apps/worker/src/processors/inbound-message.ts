import { prisma, forCompany } from '@wa/db';
import { getProvider, type InboundMessage, type StatusUpdate } from '@wa/whatsapp';
import { windowExpiryFrom, type InboundMessageJob } from '@wa/core';
import { generateAiReply } from './ai-reply.js';

/**
 * Разбор события вебхука: клиент, диалог, сообщение, ответ ассистента.
 *
 * Обработка идемпотентна: BullMQ повторяет упавшую задачу, и повтор не
 * должен ни дублировать сообщение, ни второй раз отвечать клиенту, ни
 * накручивать счётчик непрочитанных.
 */
export async function processInboundMessage({ webhookEventId }: InboundMessageJob) {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) throw new Error(`WebhookEvent ${webhookEventId} не найден`);
  if (event.status === 'PROCESSED' || event.status === 'IGNORED') return;

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  });

  try {
    const provider = getProvider();
    const messages = provider.parseWebhook(event.payload);
    const statuses = provider.parseStatuses(event.payload);
    let companyId: string | null = null;
    let handled = 0;

    for (const inbound of messages) {
      const owner = await handleOne(inbound);
      if (owner) {
        companyId = owner;
        handled += 1;
      }
    }

    // Статусы «доставлено / прочитано / не доставлено» для наших сообщений.
    let missing = 0;
    for (const status of statuses) {
      const owner = await handleStatus(status);
      if (owner === 'missing') missing += 1;
      else if (owner) {
        companyId = owner;
        handled += 1;
      }
    }

    // Meta может прислать «доставлено» раньше, чем мы успели записать своё
    // исходящее сообщение. Свежее событие — повторяем позже (BullMQ, с паузой).
    // Старое — значит, сообщение отправлено не через нас, игнорируем.
    // event прочитан до увеличения счётчика: это номер текущей попытки.
    const attempt = event.attempts + 1;
    const fresh = Date.now() - event.receivedAt.getTime() < 120_000 && attempt < 3;
    if (missing > 0 && fresh) {
      throw new Error(`статус пришёл раньше сообщения (${missing}), повтор`);
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        // Ни одно сообщение не адресовано нашим активным номерам — событие не наше.
        status: handled > 0 ? 'PROCESSED' : 'IGNORED',
        processedAt: new Date(),
        companyId,
        lastError: null,
      },
    });
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'FAILED', lastError: (error as Error).message.slice(0, 1000) },
    }).catch(() => {});
    throw error;
  }
}

const RANK = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 } as const;
type Status = keyof typeof RANK;

/**
 * Статусы приходят не по порядку: «прочитано» может прийти раньше
 * «доставлено». Двигаем статус только вперёд — иначе прочитанное
 * сообщение откатилось бы в «доставлено».
 */
async function handleStatus(update: StatusUpdate): Promise<string | 'missing' | null> {
  const message = await prisma.message.findFirst({
    where: { providerMessageId: update.providerMessageId, direction: 'OUTBOUND' },
    select: { id: true, companyId: true, conversationId: true },
  });
  if (!message) return 'missing';

  // Статус должен прийти на номер той же компании, что отправила сообщение.
  const number = await prisma.whatsAppPhoneNumber.findUnique({ where: { phoneNumberId: update.phoneNumberId } });
  if (!number || number.companyId !== message.companyId) return null;

  const next = update.status.toUpperCase() as Status;
  const lower = (Object.keys(RANK) as Status[]).filter((s) => RANK[s] < RANK[next]);
  const db = forCompany(prisma, message.companyId);

  const { count } = await db.message.updateMany({
    where: { id: message.id, status: { in: lower } },
    data: { status: next, ...(next === 'FAILED' ? { errorCode: update.errorCode ?? 'unknown' } : {}) },
  });

  // Не доставлено — менеджер должен это увидеть в переписке, а не гадать.
  if (count > 0 && next === 'FAILED') {
    await db.message.create({
      data: {
        conversationId: message.conversationId,
        direction: 'OUTBOUND',
        authorType: 'SYSTEM',
        text: `Сообщение не доставлено клиенту${update.errorTitle ? `: ${update.errorTitle}` : ''}${update.errorCode ? ` (код ${update.errorCode})` : ''}`,
        status: 'SENT',
        sentAt: new Date(),
      } as never,
    });
  }

  return message.companyId;
}

/** Возвращает companyId, если сообщение принято, иначе null. */
async function handleOne(inbound: InboundMessage): Promise<string | null> {
  const number = await prisma.whatsAppPhoneNumber.findUnique({
    where: { phoneNumberId: inbound.phoneNumberId },
  });

  // Номер не наш или клиент его отключил — не принимаем и не отвечаем.
  if (!number || number.status === 'DISCONNECTED') return null;

  const db = forCompany(prisma, number.companyId);

  // Повтор задачи после частичного выполнения: сообщение уже сохранено.
  const already = await db.message.findFirst({
    where: { providerMessageId: inbound.providerMessageId },
    select: { id: true },
  });
  if (already) return number.companyId;

  // createMany + skipDuplicates вместо create: два сообщения нового клиента
  // обрабатываются параллельно, и второе не должно падать на уникальном индексе.
  await db.customer.createMany({
    data: [{
      waId: inbound.from,
      phone: `+${inbound.from}`,
      name: inbound.profileName ?? null,
      firstContactAt: inbound.timestamp,
    }] as never,
    skipDuplicates: true,
  });
  const customer = await db.customer.findFirst({ where: { waId: inbound.from } });
  if (!customer) throw new Error(`Не удалось создать клиента ${inbound.from}`);
  if (!customer.name && inbound.profileName) {
    await db.customer.updateMany({ where: { id: customer.id }, data: { name: inbound.profileName } });
  }

  let conversation = await db.conversation.findFirst({
    where: { customerId: customer.id, status: { not: 'CLOSED' } },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { customerId: customer.id, phoneNumberId: number.id } as never,
    });
  }

  try {
    await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        authorType: 'CUSTOMER',
        type: inbound.type.toUpperCase() as never,
        text: inbound.text ?? null,
        mediaUrl: null,
        mediaMimeType: inbound.mediaMimeType ?? null,
        providerMessageId: inbound.providerMessageId,
        status: 'DELIVERED',
        sentAt: inbound.timestamp,
        metadata: inbound.mediaId ? { mediaId: inbound.mediaId } : undefined,
      } as never,
    });
  } catch (error) {
    // Параллельный дубль успел раньше — это не ошибка, просто выходим.
    if ((error as { code?: string }).code === 'P2002') return number.companyId;
    throw error;
  }

  await db.conversation.updateMany({
    where: { id: conversation.id },
    data: {
      lastMessageAt: inbound.timestamp,
      windowExpiresAt: windowExpiryFrom(inbound.timestamp),
      unreadCount: { increment: 1 },
      // Клиент написал в диалог, который вёлся с другого номера компании, —
      // отвечать нужно с того, на который он пишет сейчас.
      phoneNumberId: number.id,
    },
  });

  await db.customer.updateMany({
    where: { id: customer.id },
    data: { lastContactAt: inbound.timestamp },
  });

  // Ответ ассистента. Ошибка здесь не должна ронять приём сообщения:
  // сообщение клиента уже сохранено, менеджер увидит его в любом случае.
  if (conversation.mode === 'AI' && inbound.type === 'text') {
    try {
      await generateAiReply({
        companyId: number.companyId,
        conversationId: conversation.id,
        inboundProviderMessageId: inbound.providerMessageId,
      });
    } catch (error) {
      console.error('[ai] сбой генерации:', (error as Error).message);
    }
  }

  return number.companyId;
}
