import { dayTable, firstReplyMinutes, type Period } from '@wa/core';
import type { requireCompany } from './session';

type Ctx = Awaited<ReturnType<typeof requireCompany>>;

/**
 * Данные для таблицы «по дням». Заказы — из склада, если он подключён
 * (там настоящие продажи, менеджерам не нужно двигать этапы); иначе — по
 * этапам CRM. Менеджер видит только своих клиентов — для него всегда CRM.
 */
export async function loadDayTable(ctx: Ctx, period: Period) {
  const { db, company, ownDeals, seesOnlyOwn } = ctx;
  const range = { gte: period.from, lt: period.to };

  const [leads, lost] = await Promise.all([
    db.deal.findMany({
      where: { ...ownDeals, createdAt: range },
      select: { createdAt: true, source: true, archiveReason: true, conversationId: true },
    }),
    db.deal.findMany({ where: { ...ownDeals, lostAt: range }, select: { lostAt: true } }),
  ]);

  // Первый ответ лиду: исходящие (бот или человек) по их разговорам за период.
  const convIds = [...new Set(leads.map((l) => l.conversationId).filter((x): x is string => !!x))];
  const outbound = new Map<string, Date[]>();
  for (let i = 0; i < convIds.length; i += 1000) {
    const rows = await db.message.findMany({
      where: { conversationId: { in: convIds.slice(i, i + 1000) }, direction: 'OUTBOUND', authorType: { in: ['AI', 'MANAGER'] }, createdAt: { gte: period.from } },
      select: { conversationId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 50_000,
    });
    for (const r of rows) {
      const list = outbound.get(r.conversationId) ?? [];
      list.push(r.createdAt);
      outbound.set(r.conversationId, list);
    }
  }

  const fromSklad = !seesOnlyOwn && !!company.orderHookHash;
  const orders = fromSklad
    ? (await db.shopOrder.findMany({
        // Только заказы клиентов из WhatsApp: иначе Instagram и TikTok
        // раздуют конверсию из WhatsApp-лидов.
        where: { orderedAt: range, customerId: { not: null } },
        select: { orderedAt: true, total: true, status: true },
        // «Новый» в складе — пары отложены, денег ещё нет: это не продажа.
      })).filter((o) => o.status !== 'draft')
    : (await db.deal.findMany({
        where: { ...ownDeals, orderedAt: range },
        select: { orderedAt: true, amount: true, wonAt: true, lostAt: true },
      })).map((d) => ({ orderedAt: d.orderedAt!, total: d.amount ?? 0, status: d.wonAt ? 'completed' : d.lostAt ? 'returned' : 'paid' }));

  const table = dayTable(period.keys, company.timezone || 'Asia/Almaty', {
    leads: leads.map((l) => ({
      createdAt: l.createdAt,
      ad: l.source === 'ad',
      archived: !!l.archiveReason,
      answeredInMin: firstReplyMinutes(l.createdAt, l.conversationId ? outbound.get(l.conversationId) : undefined),
    })),
    orders,
    lostAt: lost.map((d) => d.lostAt!),
  });
  return { ...table, fromSklad };
}
