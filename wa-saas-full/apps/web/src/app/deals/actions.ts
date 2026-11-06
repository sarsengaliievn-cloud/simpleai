'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@wa/db';
import { assignDeal, moveDeal, parseAmount, ensureOpenDeal, saveStages, cleanLostReasons, CrmError, type StageDraft } from '@wa/core';
import { requireCompany } from '@/lib/session';

export type DealResult = { ok: true } | { ok: false; error: string };

function refresh() {
  revalidatePath('/deals');
  revalidatePath('/conversations');
  revalidatePath('/customers');
  revalidatePath('/analytics');
}

/** Сделка, доступная текущему пользователю: менеджеру — только своя. */
async function ownDeal(dealId: string) {
  const ctx = await requireCompany();
  const deal = await ctx.db.deal.findFirst({ where: { id: dealId, ...ctx.ownDeals } });
  return { ctx, deal };
}

const fail = (error: unknown): DealResult => {
  if (error instanceof CrmError) return { ok: false, error: error.message };
  console.error('[crm]', error);
  return { ok: false, error: 'Не удалось сохранить. Обновите страницу и попробуйте ещё раз.' };
};

/** Перенос на этап. Для «Новый заказ» — сумма и товар, для «Отказ» — причина. */
export async function moveDealAction(
  dealId: string,
  stageId: string,
  extra: { amount?: string; product?: string; comment?: string; lostReason?: string } = {},
): Promise<DealResult> {
  const { ctx, deal } = await ownDeal(dealId);
  if (!deal) return { ok: false, error: 'Сделка не найдена' };
  try {
    await moveDeal(ctx.db, {
      dealId,
      stageId,
      actorUserId: ctx.user.id,
      amount: extra.amount !== undefined ? parseAmount(extra.amount) : undefined,
      product: extra.product,
      comment: extra.comment,
      lostReason: extra.lostReason,
    });
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: true };
}

/** Передать клиента менеджеру. Делает владелец или администратор. */
export async function assignDealAction(dealId: string, assigneeId: string): Promise<DealResult> {
  const ctx = await requireCompany('team:manage');
  const member = await ctx.db.membership.findFirst({ where: { userId: assigneeId }, include: { user: true } });
  if (!member) return { ok: false, error: 'Такого сотрудника нет в команде' };
  const deal = await ctx.db.deal.findFirst({ where: { id: dealId } });
  if (!deal) return { ok: false, error: 'Сделка не найдена' };
  if (deal.assigneeId === assigneeId) return { ok: true };

  try {
    await assignDeal(ctx.db, {
      dealId,
      assigneeId,
      assigneeName: `${member.user.firstName} ${member.user.lastName}`.trim(),
      actorUserId: ctx.user.id,
    });
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: true };
}

/** Правка суммы, товара, комментария без смены этапа. */
export async function updateDealAction(
  dealId: string,
  fields: { amount?: string; product?: string; comment?: string },
): Promise<DealResult> {
  const { ctx, deal } = await ownDeal(dealId);
  if (!deal) return { ok: false, error: 'Сделка не найдена' };

  const amount = fields.amount !== undefined ? parseAmount(fields.amount) : undefined;
  if (fields.amount !== undefined && fields.amount.trim() && amount === null) {
    return { ok: false, error: 'Сумма — числом, например 25 000' };
  }
  await ctx.db.deal.updateMany({
    where: { id: dealId },
    data: {
      ...(amount !== undefined ? { amount } : {}),
      ...(fields.product !== undefined ? { product: fields.product.trim().slice(0, 300) || null } : {}),
      ...(fields.comment !== undefined ? { comment: fields.comment.trim().slice(0, 2000) || null } : {}),
    },
  });
  refresh();
  return { ok: true };
}

/** Заметка в историю сделки: «перезвонить в пятницу», «хочет чёрные». */
export async function addDealNoteAction(dealId: string, text: string): Promise<DealResult> {
  const body = text.trim().slice(0, 1000);
  if (!body) return { ok: false, error: 'Пустая заметка' };
  const { ctx, deal } = await ownDeal(dealId);
  if (!deal) return { ok: false, error: 'Сделка не найдена' };
  await ctx.db.dealEvent.create({ data: { dealId, actorUserId: ctx.user.id, type: 'note', text: body } as never });
  refresh();
  return { ok: true };
}

/* ── Этапы воронки ─────────────────────────────────────────── */

/** Сохранить этапы целиком: названия, типы, порядок, новые и удалённые. */
export async function saveStagesAction(draft: StageDraft[]): Promise<DealResult> {
  const ctx = await requireCompany('settings:manage');
  if (!Array.isArray(draft)) return { ok: false, error: 'Пустой список этапов' };
  const kinds = new Set(['NEW', 'WORK', 'ORDER', 'WON', 'LOST']);
  const clean = draft
    .filter((s) => s && typeof s.name === 'string' && kinds.has(s.kind))
    .map((s) => ({ id: typeof s.id === 'string' ? s.id : null, name: s.name.slice(0, 60), kind: s.kind }));
  try {
    await saveStages(ctx.db, clean);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: true };
}

/** Свой список причин отказа. Пустой — вернуть стандартный. */
export async function saveLostReasonsAction(list: string[]): Promise<DealResult> {
  const ctx = await requireCompany('settings:manage');
  const clean = cleanLostReasons(Array.isArray(list) ? list.map(String) : []);
  await prisma.company.update({ where: { id: ctx.company.id }, data: { lostReasons: clean } });
  refresh();
  return { ok: true };
}

/** Напомнить о клиенте: дата и о чём. at — ISO-время или пусто, чтобы снять. */
export async function setReminderAction(dealId: string, at: string | null, note: string): Promise<DealResult> {
  const { ctx, deal } = await ownDeal(dealId);
  if (!deal) return { ok: false, error: 'Сделка не найдена' };
  const when = at ? new Date(at) : null;
  if (at && (!when || Number.isNaN(when.getTime()))) return { ok: false, error: 'Не понял дату напоминания' };
  if (when && when.getTime() > Date.now() + 366 * 24 * 3600_000) return { ok: false, error: 'Напоминание — не дальше чем через год' };
  const text = note.trim().slice(0, 300) || null;
  await ctx.db.deal.updateMany({ where: { id: dealId }, data: { remindAt: when, remindNote: when ? text : null } });
  if (when) {
    const label = when.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ctx.company.timezone || 'Asia/Almaty' });
    await ctx.db.dealEvent.create({
      data: { dealId, actorUserId: ctx.user.id, type: 'note', text: `Напоминание на ${label}${text ? `: ${text}` : ''}` } as never,
    });
  }
  refresh();
  return { ok: true };
}

/** Завести сделку вручную — если клиент писал до появления CRM. */
export async function startDealAction(conversationId: string): Promise<DealResult> {
  const ctx = await requireCompany();
  const conversation = await ctx.db.conversation.findFirst({ where: { id: conversationId, ...ctx.ownConversations } });
  if (!conversation) return { ok: false, error: 'Диалог не найден' };
  await ensureOpenDeal(ctx.db, { customerId: conversation.customerId, conversationId: conversation.id });
  refresh();
  return { ok: true };
}

/** Сделку «просто вопрос» или «спам» вернуть на доску. */
export async function restoreDealAction(dealId: string): Promise<DealResult> {
  const { ctx, deal } = await ownDeal(dealId);
  if (!deal) return { ok: false, error: 'Сделка не найдена' };
  await ctx.db.deal.updateMany({ where: { id: dealId }, data: { archivedAt: null, archiveReason: null } });
  await ctx.db.dealEvent.create({ data: { dealId, actorUserId: ctx.user.id, type: 'note', text: 'Сделка снова в работе' } as never });
  refresh();
  return { ok: true };
}
