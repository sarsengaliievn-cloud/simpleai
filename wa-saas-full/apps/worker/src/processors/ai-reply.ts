import { prisma, forCompany } from '@wa/db';
import { answerQuestion } from '@wa/core';
import { getProvider } from '@wa/whatsapp';

/**
 * Ответ ассистента на входящее сообщение. Вызывается только если диалог
 * в режиме AI и ассистент включён.
 */
export async function generateAiReply({ companyId, conversationId }: {
  companyId: string; conversationId: string;
}) {
  const db = forCompany(prisma, companyId);

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const config = await db.aIConfiguration.findFirst();
  if (!config || !config.enabled) return;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    include: {
      customer: true,
      phoneNumber: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!conversation || conversation.mode !== 'AI') return;

  const ordered = [...conversation.messages].reverse();
  const last = ordered.at(-1);
  if (!last || last.direction !== 'INBOUND' || !last.text) return;

  // Память диалога: последние сообщения этого клиента и только его.
  const history = ordered.slice(0, -1)
    .filter((m) => m.text && m.authorType !== 'SYSTEM')
    .map((m) => ({ role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const), content: m.text! }));

  const result = await answerQuestion({
    companyId,
    company,
    config,
    question: last.text,
    history,
  });

  if (result.needsHuman || !result.answer) {
    await db.conversation.updateMany({ where: { id: conversationId }, data: { mode: 'HUMAN' } });
    await db.message.create({
      data: {
        conversationId,
        direction: 'OUTBOUND',
        authorType: 'SYSTEM',
        text: `Ассистент передал диалог менеджеру: уверенность ${result.confidence}% при пороге ${config.confidenceThreshold}%`,
        status: 'SENT',
        sentAt: new Date(),
        metadata: { topScore: result.topScore, modelConfidence: result.modelConfidence },
      } as never,
    });
    console.log(`[ai] ${conversationId}: передано менеджеру (${result.confidence}%)`);
    return;
  }

  if (!conversation.phoneNumber) return;

  const sent = await getProvider().sendText({
    phoneNumberId: conversation.phoneNumber.phoneNumberId,
    to: conversation.customer.waId,
    text: result.answer,
  });

  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'AI',
      type: 'TEXT',
      text: result.answer,
      providerMessageId: sent.providerMessageId,
      status: 'SENT',
      sentAt: new Date(),
      metadata: {
        confidence: result.confidence,
        topScore: result.topScore,
        sources: result.hits.slice(0, 3).map((h) => h.documentTitle),
        usage: result.usage,
      },
    } as never,
  });

  console.log(`[ai] ${conversationId}: ответ отправлен (${result.confidence}%)`);
}
