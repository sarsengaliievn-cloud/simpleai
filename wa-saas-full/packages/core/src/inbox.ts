import { forCompany, type PrismaClient, type TenantClient } from '@wa/db';
import { ensureStages, moveDeal, CLOSED_KINDS, CrmError } from './crm.js';

/**
 * Закрытие диалогов. Во «Входящих» по умолчанию только открытые: клиент
 * спросил график, получил ответ — диалог закрывается и не мешает. Написал
 * снова — диалог сам открывается, история остаётся одной перепиской.
 */

/** Итог закрытия. info — просто вопрос, spam — спам или ошибся номером, done — сделка уже закрыта. */
export type CloseOutcome = 'info' | 'won' | 'lost' | 'spam';
export const CLOSE_OUTCOMES: CloseOutcome[] = ['info', 'won', 'lost', 'spam'];

export const CLOSE_LABEL: Record<string, string> = {
  info: 'просто вопрос',
  won: 'купил',
  lost: 'отказ',
  spam: 'спам',
  done: 'сделка закрыта',
};

/** Бот ответил, клиент замолчал — через сколько закрывать. */
export const AUTO_CLOSE_INFO_MS = 24 * 60 * 60 * 1000;
/** Сделка закрыта (купил или отказ), переписка молчит — через сколько закрывать. */
export const AUTO_CLOSE_DONE_MS = 3 * 24 * 60 * 60 * 1000;
/** Сделку «просто вопрос» возвращаем в работу, если клиент вернулся в течение этого срока. */
const UNARCHIVE_MS = 3 * 24 * 60 * 60 * 1000;

/** Последняя сделка диалога, которая ещё в работе. */
async function openDealOf(db: TenantClient, conversationId: string) {
  return db.deal.findFirst({
    where: { conversationId, archivedAt: null, stage: { kind: { notIn: CLOSED_KINDS } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function closeConversation(
  db: TenantClient,
  input: {
    conversationId: string;
    outcome: CloseOutcome | 'done';
    actorUserId?: string | null;
    actorName?: string | null;
    /** Закрыл не человек, а правило — пишем почему. */
    autoNote?: string;
    lostReason?: string | null;
    amount?: number | null;
    product?: string | null;
  },
) {
  const conversation = await db.conversation.findFirst({ where: { id: input.conversationId } });
  if (!conversation) throw new CrmError('Диалог не найден');
  if (conversation.status === 'CLOSED') return;

  const deal = await openDealOf(db, conversation.id);
  if (deal && (input.outcome === 'won' || input.outcome === 'lost')) {
    const stages = await ensureStages(db);
    const target = stages.find((s) => s.kind === (input.outcome === 'won' ? 'WON' : 'LOST'));
    if (!target) throw new CrmError('Нет этапа для этого итога — проверьте этапы воронки');
    await moveDeal(db, {
      dealId: deal.id,
      stageId: target.id,
      actorUserId: input.actorUserId ?? null,
      amount: input.amount ?? null,
      product: input.product ?? null,
      lostReason: input.lostReason ?? null,
    });
  } else if (deal && (input.outcome === 'info' || input.outcome === 'spam')) {
    // Не продажа: с доски и из конверсии убираем, но не в «Отказ».
    await db.deal.updateMany({
      where: { id: deal.id },
      data: { archivedAt: new Date(), archiveReason: input.outcome, remindAt: null, remindNote: null },
    });
    await db.dealEvent.create({
      data: {
        dealId: deal.id,
        actorUserId: input.actorUserId ?? null,
        type: 'note',
        text: input.outcome === 'info' ? 'Не продажа: просто вопрос' : 'Не продажа: спам или ошибся номером',
      } as never,
    });
  } else if (input.outcome === 'lost' && !input.lostReason) {
    throw new CrmError('Выберите причину отказа');
  }

  await db.conversation.updateMany({
    where: { id: conversation.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closeReason: input.outcome,
      closedById: input.actorUserId ?? null,
      unreadCount: 0,
      // Клиент вернётся с новым вопросом — первым снова отвечает ассистент.
      mode: 'AI',
    },
  });
  await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      authorType: 'SYSTEM',
      type: 'TEXT',
      text: input.autoNote
        ? `Диалог закрыт автоматически: ${input.autoNote}`
        : `Диалог закрыт: ${CLOSE_LABEL[input.outcome]}${input.actorName ? ` (${input.actorName})` : ''}`,
      status: 'SENT',
      metadata: { closed: input.outcome },
    } as never,
  });
}

/**
 * Открыть снова — руками или потому что клиент написал. Сделку «просто
 * вопрос» недельной давности не воскрешаем: это новое обращение.
 */
export async function reopenConversation(db: TenantClient, conversationId: string, opts: { actorName?: string | null; byCustomer?: boolean } = {}) {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId } });
  if (!conversation || conversation.status !== 'CLOSED') return false;
  await db.conversation.updateMany({
    where: { id: conversationId },
    data: { status: 'OPEN', closedAt: null, closeReason: null, closedById: null },
  });
  const archived = await db.deal.findFirst({
    where: { conversationId, archivedAt: { gte: new Date(Date.now() - UNARCHIVE_MS) } },
    orderBy: { createdAt: 'desc' },
  });
  if (archived) {
    await db.deal.updateMany({ where: { id: archived.id }, data: { archivedAt: null, archiveReason: null } });
    await db.dealEvent.create({
      data: { dealId: archived.id, type: 'note', text: opts.byCustomer ? 'Клиент написал снова — сделка снова в работе' : 'Сделка снова в работе' } as never,
    });
  }
  if (!opts.byCustomer) {
    await db.message.create({
      data: {
        conversationId,
        direction: 'OUTBOUND',
        authorType: 'SYSTEM',
        type: 'TEXT',
        text: `Диалог открыт снова${opts.actorName ? ` (${opts.actorName})` : ''}`,
        status: 'SENT',
      } as never,
    });
  }
  return true;
}

/**
 * Автозакрытие, раз в 15 минут по всем компаниям:
 * 1) ответил только бот, его ответ последний, клиент молчит 24 часа —
 *    «просто вопрос» (клиент узнал график, адрес, доставку);
 * 2) сделка уже закрыта или «не продажа», переписка молчит 3 дня.
 * Диалоги, где работает менеджер и сделка открыта, не трогаем — это «зависшие».
 */
export async function autoCloseConversations(prisma: PrismaClient, now = new Date()) {
  let closed = 0;

  const quiet = await prisma.conversation.findMany({
    where: { status: { not: 'CLOSED' }, mode: 'AI', lastMessageAt: { lt: new Date(now.getTime() - AUTO_CLOSE_INFO_MS) } },
    select: {
      id: true,
      companyId: true,
      messages: { where: { authorType: { not: 'SYSTEM' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { authorType: true } },
      deals: { where: { archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { assigneeId: true, stage: { select: { kind: true } } } },
    },
    take: 500,
  });
  for (const c of quiet) {
    if (c.messages[0]?.authorType !== 'AI') continue;
    const managerWrote = await prisma.message.findFirst({ where: { conversationId: c.id, authorType: 'MANAGER' }, select: { id: true } });
    if (managerWrote) continue;
    const deal = c.deals[0];
    // Сделка уже двинулась (кто-то взял, оформил) — это не просто вопрос.
    if (deal && (deal.assigneeId || deal.stage.kind !== 'NEW')) continue;
    await closeConversation(forCompany(prisma, c.companyId), {
      conversationId: c.id,
      outcome: 'info',
      autoNote: 'клиент получил ответ ассистента и сутки не писал — просто вопрос',
    }).catch((error) => console.error('[inbox] автозакрытие:', (error as Error).message));
    closed += 1;
  }

  const done = await prisma.conversation.findMany({
    where: { status: { not: 'CLOSED' }, lastMessageAt: { lt: new Date(now.getTime() - AUTO_CLOSE_DONE_MS) } },
    select: {
      id: true,
      companyId: true,
      deals: { orderBy: { createdAt: 'desc' }, take: 1, select: { archivedAt: true, stage: { select: { kind: true } } } },
    },
    take: 500,
  });
  for (const c of done) {
    const deal = c.deals[0];
    if (!deal || !(deal.archivedAt || CLOSED_KINDS.includes(deal.stage.kind))) continue;
    await closeConversation(forCompany(prisma, c.companyId), {
      conversationId: c.id,
      outcome: 'done',
      autoNote: 'сделка закрыта и 3 дня нет новых сообщений',
    }).catch((error) => console.error('[inbox] автозакрытие:', (error as Error).message));
    closed += 1;
  }
  return closed;
}
