import { prisma, forCompany } from '@wa/db';
import { getProvider } from '@wa/whatsapp';
import { windowExpiryFrom, type InboundMessageJob } from '@wa/core';
import { generateAiReply } from './ai-reply.js';

/**
 * Спринт 2: сохраняем входящее сообщение, создаём клиента и диалог.
 * Спринт 4 добавит сюда вызов AI, спринт 5 — поиск по базе знаний.
 */
export async function processInboundMessage({ webhookEventId }: InboundMessageJob) {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) throw new Error(`WebhookEvent ${webhookEventId} не найден`);
  if (event.status === 'PROCESSED') return;

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  });

  const messages = getProvider().parseWebhook(event.payload);

  for (const inbound of messages) {
    const number = await prisma.whatsAppPhoneNumber.findUnique({
      where: { phoneNumberId: inbound.phoneNumberId },
    });

    // Номер не привязан ни к одной компании — событие не наше.
    if (!number) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'IGNORED', processedAt: new Date() },
      });
      return;
    }

    const db = forCompany(prisma, number.companyId);

    let customer = await db.customer.findFirst({ where: { waId: inbound.from } });
    if (!customer) {
      customer = await db.customer.create({
        data: {
          waId: inbound.from,
          phone: `+${inbound.from}`,
          name: inbound.profileName ?? null,
        } as never,
      });
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
      } as never,
    });

    await db.conversation.updateMany({
      where: { id: conversation.id },
      data: {
        lastMessageAt: inbound.timestamp,
        windowExpiresAt: windowExpiryFrom(inbound.timestamp),
        unreadCount: { increment: 1 },
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
        await generateAiReply({ companyId: number.companyId, conversationId: conversation.id });
      } catch (error) {
        console.error('[ai] сбой генерации:', (error as Error).message);
      }
    }
  }

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { status: 'PROCESSED', processedAt: new Date(), companyId: undefined },
  });
}
