import { prisma, forCompany } from '@wa/db';
import { getProvider, type InboundMessage } from '@wa/whatsapp';
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
    const messages = getProvider().parseWebhook(event.payload);
    let companyId: string | null = null;
    let handled = 0;

    for (const inbound of messages) {
      const owner = await handleOne(inbound);
      if (owner) {
        companyId = owner;
        handled += 1;
      }
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
