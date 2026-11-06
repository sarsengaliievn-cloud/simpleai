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
  aiErrorReason,
  autoAssignConversation,
  orderQuestion,
  orderConfirmation,
  partnerReply,
  sendWhatsAppMedia,
  assertPublicUrl,
  type AnswerResult,
} from '@wa/core';
import { getProvider } from '@wa/whatsapp';

type Db = ReturnType<typeof forCompany>;

/** Сообщение «вне графика» — не чаще раза в 12 часов на диалог, иначе это спам. */
const OFF_HOURS_REPEAT_MS = 12 * 60 * 60 * 1000;
/** Ответ на фото — не чаще раза в 2 часа; следующее фото уже к менеджеру. */
const PHOTO_REPEAT_MS = 2 * 60 * 60 * 1000;

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
  // Фото и задан «ответ на фото» — бот сам отвечает (каталог, просьба написать
  // артикул) и ведёт разговор дальше. Повторное фото в течение 2 часов —
  // значит, клиент так и не нашёл модель: зовём человека.
  const blind = (m: (typeof tail)[number]) => (m.type === 'AUDIO' && !m.text) || NEEDS_EYES.has(m.type);
  const photoReply = config.photoReply.trim();
  if (photoReply && tail.some((m) => m.type === 'IMAGE') && !tail.some((m) => blind(m) && m.type !== 'IMAGE')) {
    const recent = await db.message.findFirst({
      where: { conversationId, authorType: 'AI', createdAt: { gte: new Date(Date.now() - PHOTO_REPEAT_MS) }, metadata: { path: ['photoReply'], equals: true } },
      select: { id: true },
    });
    if (!recent) {
      const outcome = await sendAsAssistant(db, conversationId, photoReply, { photoReply: true });
      if (typeof outcome === 'object') {
        await handOff(db, conversationId, `Ассистент хотел ответить на фото, но WhatsApp не принял сообщение: ${outcome.reason} Диалог передан менеджеру.`, { error: outcome.error });
      } else if (outcome === 'sent' && last.providerMessageId && conversation.phoneNumber) {
        await markWhatsAppRead(db, { phoneNumberRowId: conversation.phoneNumber.id, providerMessageId: last.providerMessageId });
      }
      console.log(`[ai] ${conversationId}: фото — отправлен ответ на фото (${outcome === 'sent' ? 'ок' : 'не ушёл'})`);
      return;
    }
    await handOff(db, conversationId, 'Клиент снова прислал фото — похоже, сам модель не нашёл. Диалог передан менеджеру.', { attachment: 'IMAGE', repeat: true });
    return;
  }

  const attachment = tail.find(blind);
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

  const catalog = config.catalogUrl.trim()
    ? { url: config.catalogUrl.trim(), productUrl: config.catalogProductUrl.trim() || null, photoUrl: config.catalogPhotos ? config.catalogPhotoUrl.trim() || null : null }
    : null;
  const result = await answerQuestion({ companyId, company, config, question, history, catalog });
  // ИИ снова отвечает — плашка «ИИ не работает» больше не нужна.
  if (config.lastErrorAt) {
    await db.aIConfiguration.updateMany({ data: { lastErrorAt: null, lastError: null } });
  }
  // Списание за ответ — даже если бот в итоге позвал менеджера: модель отработала.
  await recordUsage(companyId, 'reply', {
    provider: billingProvider(result.ai),
    model: result.ai.model,
    ...result.usage,
  }, conversationId);

  // ── Пишет не покупатель ────────────────────
  // Маркетплейс, реклама, поставщик: короткое «передам руководству», сделку
  // убираем с доски продаж, диалог — людям.
  if (result.partner) {
    const outcome = await sendAsAssistant(db, conversationId, partnerReply(result.partner.lang), { partner: true });
    if (outcome === 'sent' && last.providerMessageId && conversation.phoneNumber) {
      await markWhatsAppRead(db, { phoneNumberRowId: conversation.phoneNumber.id, providerMessageId: last.providerMessageId });
    }
    await db.deal.updateMany({
      where: { conversationId, archivedAt: null, stage: { kind: 'NEW' }, assigneeId: null },
      data: { archivedAt: new Date(), archiveReason: 'b2b' },
    });
    await handOff(db, conversationId, 'Пишет не покупатель: предложение о сотрудничестве, рекламе или услугах — бот не стал рассказывать про товары, диалог передан людям.', { partner: true });
    console.log(`[ai] ${conversationId}: не покупатель — передано людям`);
    return;
  }

  // ── Клиент готов купить ────────────────────
  if (result.order) {
    await handleOrder(db, { conversationId, result, lastProviderMessageId: last.providerMessageId, phoneNumberRowId: conversation.phoneNumber?.id ?? null });
    return;
  }

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

  // Подобранные модели — фотографиями, как показал бы продавец.
  if (sentCount === parts.length && result.photos?.length) {
    await sendPhotos(db, conversationId, result.photos);
  }

  console.log(`[ai] ${conversationId}: ответ отправлен (${result.confidence}%, частей ${sentCount}/${parts.length})`);
}

/** Сколько ждём, пока клиент ответит на уточнение заказа, прежде чем спросить снова. */
const ORDER_ASK_MS = 2 * 60 * 60 * 1000;

/**
 * Клиент сказал «беру». Не хватает модели, размера или города — бот один
 * раз переспрашивает. Всё есть (или уже спрашивали) — короткое «передаю
 * менеджеру» клиенту, а менеджеру сводка: модель, размер, город, наличие.
 * Резерв бот не ставит — это решает менеджер.
 */
async function handleOrder(
  db: Db,
  input: { conversationId: string; result: AnswerResult; lastProviderMessageId: string | null; phoneNumberRowId: string | null },
) {
  const { conversationId, result } = input;
  const order = result.order!;
  const markRead = async () => {
    if (input.lastProviderMessageId && input.phoneNumberRowId) {
      await markWhatsAppRead(db, { phoneNumberRowId: input.phoneNumberRowId, providerMessageId: input.lastProviderMessageId });
    }
  };

  if (order.missing.length) {
    const asked = await db.message.findFirst({
      where: { conversationId, authorType: 'AI', createdAt: { gte: new Date(Date.now() - ORDER_ASK_MS) }, metadata: { path: ['orderAsk'], equals: true } },
      select: { id: true },
    });
    if (!asked) {
      const outcome = await sendAsAssistant(db, conversationId, orderQuestion(order), { orderAsk: true, missing: order.missing });
      if (outcome === 'sent') {
        await markRead();
        console.log(`[ai] ${conversationId}: готов купить — уточняю ${order.missing.join(', ')}`);
        return;
      }
      if (outcome === 'skipped') return;
    }
  }

  const outcome = await sendAsAssistant(db, conversationId, orderConfirmation(order.lang), { orderConfirm: true });
  if (outcome === 'sent') await markRead();

  // В сделку — что выбрал клиент; сумму и товар менеджер поправит при оформлении.
  const deal = await db.deal.findFirst({
    where: { conversationId, archivedAt: null, stage: { kind: { notIn: ['WON', 'LOST'] } } },
    orderBy: { createdAt: 'desc' },
  });
  if (deal) {
    await db.deal.updateMany({
      where: { id: deal.id },
      data: {
        ...(order.product && !deal.product ? { product: order.product.slice(0, 300) } : {}),
        ...(order.amount && !deal.amount ? { amount: order.amount } : {}),
        ...(order.comment && !deal.comment ? { comment: order.comment.slice(0, 2000) } : {}),
      },
    });
    await db.dealEvent.create({
      data: { dealId: deal.id, type: 'note', text: `Бот: клиент готов купить.\n${order.summary}` } as never,
    });
  }

  const missingNote = order.missing.length ? `\nНе уточнил: ${order.missing.map((f) => ({ model: 'модель', size: 'размер', city: 'город или способ получения' })[f]).join(', ')}.` : '';
  await handOff(db, conversationId, `🛒 Клиент готов купить — диалог передан менеджеру.\n${order.summary}${missingNote}`, {
    order: { summary: order.summary, product: order.product, amount: order.amount, comment: order.comment, missing: order.missing },
  });
  console.log(`[ai] ${conversationId}: готов купить — передано менеджеру`);
}

/** Фото моделей из каталога: скачиваем со склада и отправляем с подписью. Сбой фото — не повод звать менеджера. */
async function sendPhotos(db: Db, conversationId: string, photos: Array<{ url: string; caption: string }>) {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId }, include: { customer: true, phoneNumber: true } });
  if (!conversation?.phoneNumber || conversation.mode !== 'AI' || !isWindowOpen(conversation.windowExpiresAt)) return;
  for (const photo of photos.slice(0, 3)) {
    try {
      await assertPublicUrl(photo.url);
      const res = await fetch(photo.url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!res.ok || !/^image\/(jpeg|png)$/.test(type)) continue;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length === 0 || data.length > 5 * 1024 * 1024) continue;
      await sleep(800);
      const sent = await sendWhatsAppMedia(db, {
        phoneNumberRowId: conversation.phoneNumber.id,
        to: conversation.customer.waId,
        kind: 'image',
        data,
        mimeType: type,
        caption: photo.caption.slice(0, 1000),
      });
      await db.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          authorType: 'AI',
          type: 'IMAGE',
          text: photo.caption,
          mediaMimeType: type,
          providerMessageId: sent.providerMessageId,
          status: 'SENT',
          sentAt: new Date(),
          metadata: { mediaId: sent.mediaId, catalogPhoto: true },
        } as never,
      });
    } catch (error) {
      console.warn(`[ai] ${conversationId}: фото модели не отправлено —`, (error as Error).message.slice(0, 200));
    }
  }
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
  // Бот отдал диалог — следующему по очереди менеджеру на смене.
  const conversation = await db.conversation.findFirst({ where: { id: conversationId }, select: { companyId: true } });
  if (conversation) {
    await autoAssignConversation(db, { companyId: conversation.companyId, conversationId }).catch((error) =>
      console.error('[crm] авто-распределение:', (error as Error).message),
    );
  }
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

/**
 * Ответ так и не получился после всех повторов (ключ, модель, сбой у
 * провайдера). Раньше диалог оставался «у бота» и клиент ждал вечно —
 * теперь он сразу уходит менеджеру с понятной причиной, а в панели
 * загорается плашка «ИИ не работает».
 */
export async function aiReplyFailed({ companyId, conversationId }: AiReplyJob, error: Error) {
  const db = forCompany(prisma, companyId);
  const config = await db.aIConfiguration.findFirst();
  const reason = aiErrorReason(error.message, config?.aiModel ?? null);
  await db.aIConfiguration.updateMany({ data: { lastErrorAt: new Date(), lastError: reason } });
  await handOff(db, conversationId, `Ассистент не смог ответить: ${reason}. Диалог передан менеджеру.`, { aiError: reason });
  console.error(`[ai] ${conversationId}: сбой ИИ после повторов (${reason}) — передано менеджеру`);
}
