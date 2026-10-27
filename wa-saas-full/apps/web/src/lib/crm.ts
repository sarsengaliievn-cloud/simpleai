import type { TenantClient } from '@wa/db';
import { ensureStages } from '@wa/core';

export type StageView = { id: string; name: string; kind: 'NEW' | 'WORK' | 'ORDER' | 'WON' | 'LOST' };
export type MemberView = { id: string; name: string };
export type DealView = {
  id: string;
  stageId: string;
  amount: number | null;
  product: string | null;
  comment: string | null;
  lostReason: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  conversationId: string | null;
  createdAt: Date;
  stageChangedAt: Date;
  customer: { id: string; name: string; phone: string; city: string | null };
  events: Array<{ id: string; type: string; text: string; createdAt: Date; actor: string | null }>;
};

const fullName = (u: { firstName: string; lastName: string } | null | undefined) =>
  u ? `${u.firstName} ${u.lastName}`.trim() : null;

export async function loadStages(db: TenantClient): Promise<StageView[]> {
  const stages = await ensureStages(db);
  return stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind as StageView['kind'] }));
}

/** Команда для выбора «передать менеджеру». */
export async function loadMembers(db: TenantClient): Promise<MemberView[]> {
  const members = await db.membership.findMany({ include: { user: true }, orderBy: { createdAt: 'asc' } });
  return members.map((m) => ({ id: m.userId, name: fullName(m.user) ?? m.user.email }));
}

/** Сделка со всем, что нужно карточке: клиент, менеджер, история. */
export async function loadDeal(db: TenantClient, where: Record<string, unknown>): Promise<DealView | null> {
  const deal = await db.deal.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: true,
      assignee: true,
      events: { orderBy: { createdAt: 'desc' }, take: 30, include: { actor: true } },
    },
  });
  if (!deal) return null;
  return {
    id: deal.id,
    stageId: deal.stageId,
    amount: deal.amount,
    product: deal.product,
    comment: deal.comment,
    lostReason: deal.lostReason,
    assigneeId: deal.assigneeId,
    assigneeName: fullName(deal.assignee),
    conversationId: deal.conversationId,
    createdAt: deal.createdAt,
    stageChangedAt: deal.stageChangedAt,
    customer: {
      id: deal.customer.id,
      name: deal.customer.name ?? `+${deal.customer.waId}`,
      phone: deal.customer.phone,
      city: deal.customer.city,
    },
    events: deal.events.map((e) => ({ id: e.id, type: e.type, text: e.text, createdAt: e.createdAt, actor: fullName(e.actor) })),
  };
}
