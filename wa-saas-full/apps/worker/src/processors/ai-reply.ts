import { prisma, forCompany } from '@wa/db';
import {
  answerQuestion,
  isWindowOpen,
  isWithinWorkingHours,
  splitReply,
  typingDelayMs,
  decryptSecret,
  transcribeAudio,
  hasBalance,
  recordUsage,
  resolveAI,
  billingProvider,
  estimateAudioSeconds,
  type AIChoice,
  sendWhatsAppText,
  markWhatsAppRead,
  sendErrorText,
  type AiReplyJob,
} from '@wa/core';
import { getProvider } from '@wa/whatsapp';

type Db = ReturnType<typeof forCompany>;

/** Сообщение «вне графика» — не чаще раза в 12 часов на диалог, иначе это спам. */
const OFF_HOURS_REPEAT_MS = 12 * 60 * 60 * 1000;

/** Вложения, которые ассистент не видит, — на них отвечает человек. */
const NEEDS_EYES = new Set(['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ответ ассистента на серию сообщений клиента. Запускается из очереди
 * ai-reply с задержкой (буферизация), см. apps/worker/src/queues.ts.
 */
export async function generateAiReply({ companyId, conversationId, inboundMessageId }: AiReplyJob) {
  const db = forCompany(prisma, companyId);

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const config = await db.aIConfiguration.findFirst();
  if (!config || !config.enabled) return;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    include: {
      customer: true,
      phoneNumber: { include: { account: { select: { accessToken: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!conversation || conversation.mode !== 'AI') return;

  // Системные пометки («передано менеджеру») в счёт не идут.
  const ordered = [...conversation.messages].reverse().filter((m) => m.authorType !== 'SYSTEM');
  const last = ordered.at(-1);
  if (!last || last.direction !== 'INBOUND') return;

  // Буферизация: клиент прислал три сообщения подряд — три задачи. Отвечает
  // только задача последнего сообщения: к её запуску серия уже закончилась.
  if (last.id !== inboundMessageId) return;

  // Сообщения клиента, идущие подряд в конце, — это один вопрос.
  let tailStart = ordered.length;
  while (tailStart > 0 && ordered[tailStart - 1]!.direction === 'INBOUND') tailStart -= 1;
  const tail = ordered.slice(tailStart);

  // ── Рабочие часы ───────────────────────────
  if (config.workingHoursEnabled && !isWithinWorkingHours(new Date(), company.timezone, {
    days: config.workingDays, start: config.workStart, end: config.workEnd,
  })) {
    await sendOffHoursNotice(db, conversation, config.offHoursMessage);
    console.log(`[ai] ${conversationId}: вне рабочих часов, ассистент молчит`);
    return;
  }

  // ── Баланс ИИ ──────────────────────────────
  // Денег нет — бот не отвечает, клиент уходит к людям. Пометка одна на диалог.
  if (!(await hasBalance(companyId))) {
    await handOff(db, conversationId, 'Баланс ИИ закончился — бот передал диалог менеджеру. Пополните баланс в разделе «Баланс».', { billing: 'empty' });
    console.log(`[ai] ${conversationId}: баланс ИИ исчерпан — передано менеджеру`);
    return;
  }
  const choice = resolveAI(config);

  // ── Голосовые → текст ──────────────────────
  for (const message of tail) {
    if (message.type !== 'AUDIO' || message.text) continue;
    const meta = (message.metadata ?? {}) as { mediaId?: string; transcribed?: boolean };
    if (!config.transcribeVoice || !meta.mediaId || meta.transcribed === false) continue;
    message.text = await transcribeVoice(db, message.id, meta.mediaId, conversation.phoneNumber?.account.accessToken, { companyId, conversationId, choice });
  }

  // ── Вложения, которых ассистент не понимает ─
  // Фото с подписью «такие есть?» тоже сюда: без картинки ассистент
  // ответил бы наугад, а это ровно то, что запрещает базовое правило.
  const attachment = tail.find((m) => (m.type === 'AUDIO' && !m.text) || NEEDS_EYES.has(m.type));
  if (attachment) {
    const what = attachment.type;
    await handOff(db, conversationId, ATTACHMENT_REASON[what] ?? 'Клиент прислал вложение', { attachment: what });
    console.log(`[ai] ${conversationId}: вложение ${what} — передано менеджеру`);
    return;
  }

  const question = tail.map((m) => m.text).filter(Boolean).join('\n');
  // Только стикеры и реакции — отвечать не на что, менеджера тоже не дёргаем.
  if (!question) return;

  // Память диалога: всё, что было до этой серии вопросов.
  const history = ordered.slice(0, tailStart)
    .filter((m) => m.text)
    .map((m) => ({ role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const), content: m.text! }));

  const result = await answerQuestion({ companyId, company, config, question, history });
  // Списание за ответ — даже если бот в итоге позвал менеджера: модель отработала.
  await recordUsage(companyId, 'reply', {
    provider: billingProvider(result.ai),
    model: result.ai.model,
    ...result.usage,
  }, conversationId);

  if (result.needsHuman || !result.answer) {
    await handOff(
      db,
      conversationId,
      result.confidence === 0 && result.topScore === 0
        ? 'Ассистент передал диалог менеджеру: в базе знаний нет ответа на этот вопрос'
        : `Ассистент передал диалог менеджеру: уверенность ${result.confidence}% при пороге ${config.confidenceThreshold}%`,
      { topScore: result.topScore, modelConfidence: result.modelConfidence },
    );
    console.log(`[ai] ${conversationId}: передано менеджеру (${result.confidence}%)`);
    return;
  }

  // ── Отправка, при необходимости частями ────
  const parts = config.splitReplies ? splitReply(result.answer, config.splitMaxChars) : [result.answer];
  const meta = {
    confidence: result.confidence,
    topScore: result.topScore,
    sources: [...new Set(result.hits.slice(0, 3).map((h) => h.documentTitle))],
    usage: result.usage,
  };

  let sentCount = 0;
  for (const [index, part] of parts.entries()) {
    if (index > 0) await sleep(typingDelayMs(part));
    const outcome = await sendAsAssistant(db, conversationId, part, {
      ...(index === 0 ? meta : {}),
      ...(parts.length > 1 ? { part: index + 1, of: parts.length } : {}),
    });
    if (outcome !== 'sent') {
      // WhatsApp не принял — диалог человеку, с причиной и неотправленным остатком.
      if (typeof outcome === 'object') {
        await handOff(
          db,
          conversationId,
          `Ассистент подготовил ответ, но WhatsApp его не принял: ${outcome.reason} Диалог передан менеджеру.`,
          { draft: parts.slice(index).join('\n\n'), error: outcome.error },
        );
        console.error(`[ai] ${conversationId}: отправка не удалась —`, outcome.error);
        return;
      }
      // 'skipped': менеджер забрал диалог или закрылось окно — остальные части не шлём.
      break;
    }
    sentCount += 1;
    // Клиент видит синие галочки: его сообщение прочитано и на него ответили.
    if (index === 0 && last.providerMessageId && conversation.phoneNumber) {
      await markWhatsAppRead(db, { phoneNumberRowId: conversation.phoneNumber.id, providerMessageId: last.providerMessageId });
    }
  }

  console.log(`[ai] ${conversationId}: ответ отправлен (${result.confidence}%, частей ${sentCount}/${parts.length})`);
}

const ATTACHMENT_REASON: Record<string, string> = {
  AUDIO: 'Клиент прислал голосовое, ассистент его не расшифровал — передано менеджеру',
  IMAGE: 'Клиент прислал фото — ассистент не видит изображения, передано менеджеру',
  VIDEO: 'Клиент прислал видео — передано менеджеру',
  DOCUMENT: 'Клиент прислал файл — передано менеджеру',
  LOCATION: 'Клиент прислал геолокацию — передано менеджеру',
};

/**
 * Отправить текст от имени ассистента. Всё проверяется непосредственно
 * перед отправкой: генерация и паузы между частями занимают время, за
 * которое менеджер мог забрать диалог, а окно 24 часа — закрыться.
 */
async function sendAsAssistant(
  db: Db,
  conversationId: string,
  text: string,
  metadata: Record<string, unknown>,
): Promise<'sent' | 'skipped' | { reason: string; error: string }> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    include: { customer: true, phoneNumber: true },
  });
  if (!conversation || conversation.mode !== 'AI') return 'skipped';
  if (!conversation.phoneNumber || conversation.phoneNumber.status === 'DISCONNECTED') return 'skipped';
  if (!isWindowOpen(conversation.windowExpiresAt)) return 'skipped';

  let sent: { providerMessageId: string };
  try {
    // Лимиты и временные сбои Meta — пара повторов прямо здесь. Повтор всей
    // задачи заново генерировал бы ответ и тратил запросы к модели.
    sent = await sendWhatsAppText(db, {
      phoneNumberRowId: conversation.phoneNumber.id,
      to: conversation.customer.waId,
      text,
      retries: 2,
    });
  } catch (error) {
    return { reason: sendErrorText(error), error: (error as Error).message.slice(0, 300) };
  }

  const now = new Date();
  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'AI',
      type: 'TEXT',
      text,
      providerMessageId: sent.providerMessageId,
      status: 'SENT',
      sentAt: now,
      metadata,
    } as never,
  });
  await db.conversation.updateMany({ where: { id: conversationId }, data: { lastMessageAt: now } });
  return 'sent';
}

/** Диалог — менеджеру, с понятной пометкой в ленте. Повторно не помечаем. */
async function handOff(db: Db, conversationId: string, text: string, metadata: Record<string, unknown>) {
  const { count } = await db.conversation.updateMany({
    where: { id: conversationId, mode: 'AI' },
    data: { mode: 'HUMAN' },
  });
  if (count === 0) return;
  await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      authorType: 'SYSTEM',
      text,
      status: 'SENT',
      sentAt: new Date(),
      metadata,
    } as never,
  });
}

/**
 * Вне графика: если задан текст — отправить его один раз (не чаще раза
 * в 12 часов на диалог). Диалог остаётся у ассистента: когда клиент
 * напишет в рабочее время, ассистент ответит как обычно.
 */
async function sendOffHoursNotice(db: Db, conversation: { id: string }, text: string) {
  if (!text.trim()) return;
  const recent = await db.message.findFirst({
    where: {
      conversationId: conversation.id,
      authorType: 'AI',
      createdAt: { gt: new Date(Date.now() - OFF_HOURS_REPEAT_MS) },
      metadata: { path: ['offHours'], equals: true },
    },
    select: { id: true },
  });
  if (recent) return;
  await sendAsAssistant(db, conversation.id, text.trim(), { offHours: true });
}

/**
 * Скачать голосовое и записать расшифровку в text. Сбой помечается в
 * metadata (transcribed: false), чтобы повтор задачи не тратил запросы
 * впустую, — и ассистент передаёт диалог менеджеру.
 */
async function transcribeVoice(
  db: Db,
  messageId: string,
  mediaId: string,
  encryptedToken: string | undefined,
  bill: { companyId: string; conversationId: string; choice: AIChoice },
): Promise<string | null> {
  let accessToken: string | null = null;
  try {
    accessToken = encryptedToken ? decryptSecret(encryptedToken) : null;
  } catch {
    accessToken = null;
  }

  try {
    const media = await getProvider().downloadMedia({ mediaId, accessToken });
    const text = (await transcribeAudio(media.data, media.mimeType, bill.choice)).slice(0, 4000);
    await recordUsage(bill.companyId, 'voice', {
      provider: billingProvider(bill.choice),
      model: bill.choice.model,
      audioSeconds: estimateAudioSeconds(media.data.length),
    }, bill.conversationId);
    await db.message.updateMany({
      where: { id: messageId },
      data: {
        text: text || null,
        mediaMimeType: media.mimeType,
        metadata: { mediaId, transcribed: Boolean(text), voiceBytes: media.data.length },
      },
    });
    console.log(`[voice] ${messageId}: ${text ? `расшифровано, ${text.length} симв.` : 'речи не слышно'}`);
    return text || null;
  } catch (error) {
    const reason = (error as Error).message.slice(0, 300);
    console.error(`[voice] ${messageId}: не расшифровано —`, reason);
    await db.message.updateMany({
      where: { id: messageId },
      data: { metadata: { mediaId, transcribed: false, transcribeError: reason } },
    });
    return null;
  }
}
