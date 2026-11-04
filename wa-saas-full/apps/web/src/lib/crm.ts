import type { TenantClient } from '@wa/db';
import { ensureStages, sourceLabel } from '@wa/core';

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
  remindAt: Date | null;
  remindNote: string | null;
  /** Откуда пришёл: «WhatsApp напрямую» или заголовок рекламы. */
  source: string;
  adUrl: string | null;
  /** Прошлые покупки этого клиента — повторный клиент. */
  purchases: Array<{ id: string; amount: number | null; product: string | null; at: Date }>;
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
  const purchases = await db.deal.findMany({
    where: { customerId: deal.customerId, wonAt: { not: null }, id: { not: deal.id } },
    orderBy: { wonAt: 'desc' },
    take: 10,
    select: { id: true, amount: true, product: true, wonAt: true },
  });
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
    remindAt: deal.remindAt,
    remindNote: deal.remindNote,
    source: sourceLabel(deal),
    adUrl: deal.adSourceUrl,
    purchases: purchases.map((p) => ({ id: p.id, amount: p.amount, product: p.product, at: p.wonAt! })),
    customer: {
      id: deal.customer.id,
      name: deal.customer.name ?? `+${deal.customer.waId}`,
      phone: deal.customer.phone,
      city: deal.customer.city,
    },
    events: deal.events.map((e) => ({ id: e.id, type: e.type, text: e.text, createdAt: e.createdAt, actor: fullName(e.actor) })),
  };
}

/** Сколько покупок было у каждого клиента — для отметки «повторный». */
export async function purchaseCounts(db: TenantClient, customerIds: string[]) {
  if (customerIds.length === 0) return new Map<string, number>();
  const rows = await db.deal.groupBy({
    by: ['customerId'],
    where: { customerId: { in: [...new Set(customerIds)] }, wonAt: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.customerId, r._count._all]));
}
