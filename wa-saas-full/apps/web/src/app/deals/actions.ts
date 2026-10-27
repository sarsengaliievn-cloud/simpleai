'use server';

import { revalidatePath } from 'next/cache';
import { assignDeal, moveDeal, parseAmount, ensureOpenDeal, CrmError } from '@wa/core';
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

export async function renameStageAction(stageId: string, name: string): Promise<DealResult> {
  const ctx = await requireCompany('settings:manage');
  const clean = name.trim().slice(0, 40);
  if (!clean) return { ok: false, error: 'Название не может быть пустым' };
  await ctx.db.pipelineStage.updateMany({ where: { id: stageId }, data: { name: clean } });
  refresh();
  return { ok: true };
}

/** Свой этап «в работе» — встаёт перед «Новый заказ». */
export async function addStageAction(name: string): Promise<DealResult> {
  const ctx = await requireCompany('settings:manage');
  const clean = name.trim().slice(0, 40);
  if (!clean) return { ok: false, error: 'Введите название этапа' };
  const stages = await ctx.db.pipelineStage.findMany({ orderBy: { position: 'asc' } });
  if (stages.length >= 12) return { ok: false, error: 'Больше 12 этапов — воронку трудно читать' };
  const order = stages.find((s) => s.kind === 'ORDER');
  const at = order ? order.position : stages.length;
  // Сдвигаем всё, что после, на одну позицию.
  for (const s of stages.filter((x) => x.position >= at).reverse()) {
    await ctx.db.pipelineStage.updateMany({ where: { id: s.id }, data: { position: s.position + 1 } });
  }
  await ctx.db.pipelineStage.create({ data: { name: clean, kind: 'WORK', position: at } as never });
  refresh();
  return { ok: true };
}

/** Удалить можно только свой этап «в работе»; его сделки уходят на соседний. */
export async function deleteStageAction(stageId: string): Promise<DealResult> {
  const ctx = await requireCompany('settings:manage');
  const stages = await ctx.db.pipelineStage.findMany({ orderBy: { position: 'asc' } });
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return { ok: false, error: 'Этап не найден' };
  const work = stages.filter((s) => s.kind === 'WORK');
  if (stage.kind !== 'WORK') return { ok: false, error: 'Этот этап нужен для подсчёта конверсии — его можно только переименовать' };
  if (work.length <= 1) return { ok: false, error: 'Нужен хотя бы один этап «в работе»' };

  const target = work.find((s) => s.id !== stage.id)!;
  await ctx.db.deal.updateMany({ where: { stageId: stage.id }, data: { stageId: target.id } });
  await ctx.db.pipelineStage.deleteMany({ where: { id: stage.id } });
  refresh();
  return { ok: true };
}

/** Сдвиг своего этапа влево или вправо — только среди этапов «в работе». */
export async function shiftStageAction(stageId: string, dir: -1 | 1): Promise<DealResult> {
  const ctx = await requireCompany('settings:manage');
  const stages = await ctx.db.pipelineStage.findMany({ orderBy: { position: 'asc' } });
  const i = stages.findIndex((s) => s.id === stageId);
  const other = stages[i + dir];
  if (i < 0 || !other || stages[i]!.kind !== 'WORK' || other.kind !== 'WORK') return { ok: true };
  await ctx.db.pipelineStage.updateMany({ where: { id: stages[i]!.id }, data: { position: other.position } });
  await ctx.db.pipelineStage.updateMany({ where: { id: other.id }, data: { position: stages[i]!.position } });
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
