import { prisma, forCompany } from '@wa/db';
import { answerQuestion, isWindowOpen } from '@wa/core';
import { getProvider } from '@wa/whatsapp';

/**
 * Ответ ассистента на входящее сообщение. Вызывается только если диалог
 * в режиме AI и ассистент включён.
 */
export async function generateAiReply({ companyId, conversationId, inboundProviderMessageId }: {
  companyId: string;
  conversationId: string;
  /** Сообщение, на которое отвечаем. Если после него клиент уже написал ещё — молчим. */
  inboundProviderMessageId?: string;
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
      messages: { orderBy: { createdAt: 'desc' }, take: 12 },
    },
  });
  if (!conversation || conversation.mode !== 'AI') return;

  // Системные пометки («передано менеджеру») в счёт не идут.
  const ordered = [...conversation.messages].reverse().filter((m) => m.authorType !== 'SYSTEM');
  const last = ordered.at(-1);
  if (!last || last.direction !== 'INBOUND' || !last.text) return;

  // Клиент прислал три сообщения подряд — три задачи в очереди. Отвечает
  // только та, что пришла за последним: она видит всю серию в истории,
  // а клиент получает один ответ вместо трёх.
  if (inboundProviderMessageId && last.providerMessageId !== inboundProviderMessageId) return;

  // Сообщения клиента, идущие подряд в конце, — это один вопрос.
  const tail: string[] = [];
  for (let i = ordered.length - 1; i >= 0 && ordered[i]!.direction === 'INBOUND'; i -= 1) {
    if (ordered[i]!.text) tail.unshift(ordered[i]!.text!);
  }
  const question = tail.join('\n');

  // Память диалога: всё, что было до этой серии вопросов.
  const history = ordered.slice(0, ordered.length - tail.length)
    .filter((m) => m.text)
    .map((m) => ({ role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const), content: m.text! }));

  const result = await answerQuestion({ companyId, company, config, question, history });

  if (result.needsHuman || !result.answer) {
    const { count } = await db.conversation.updateMany({
      where: { id: conversationId, mode: 'AI' },
      data: { mode: 'HUMAN' },
    });
    if (count > 0) {
      await db.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          authorType: 'SYSTEM',
          text: result.confidence === 0 && result.topScore === 0
            ? 'Ассистент передал диалог менеджеру: в базе знаний нет ответа на этот вопрос'
            : `Ассистент передал диалог менеджеру: уверенность ${result.confidence}% при пороге ${config.confidenceThreshold}%`,
          status: 'SENT',
          sentAt: new Date(),
          metadata: { topScore: result.topScore, modelConfidence: result.modelConfidence },
        } as never,
      });
    }
    console.log(`[ai] ${conversationId}: передано менеджеру (${result.confidence}%)`);
    return;
  }

  if (!conversation.phoneNumber || conversation.phoneNumber.status === 'DISCONNECTED') return;
  // Генерация могла занять время — окно проверяем непосредственно перед отправкой.
  if (!isWindowOpen(conversation.windowExpiresAt)) return;

  // Пока шла генерация, менеджер мог забрать диалог.
  const still = await db.conversation.findFirst({ where: { id: conversationId }, select: { mode: true } });
  if (still?.mode !== 'AI') return;

  const sent = await getProvider().sendText({
    phoneNumberId: conversation.phoneNumber.phoneNumberId,
    to: conversation.customer.waId,
    text: result.answer,
  });

  const now = new Date();
  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'AI',
      type: 'TEXT',
      text: result.answer,
      providerMessageId: sent.providerMessageId,
      status: 'SENT',
      sentAt: now,
      metadata: {
        confidence: result.confidence,
        topScore: result.topScore,
        sources: [...new Set(result.hits.slice(0, 3).map((h) => h.documentTitle))],
        usage: result.usage,
      },
    } as never,
  });
  await db.conversation.updateMany({ where: { id: conversationId }, data: { lastMessageAt: now } });

  console.log(`[ai] ${conversationId}: ответ отправлен (${result.confidence}%)`);
}
