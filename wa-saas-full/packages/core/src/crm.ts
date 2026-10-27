import { DEFAULT_STAGES, type TenantClient } from '@wa/db';

/**
 * CRM: воронка и сделки. Логика здесь, а не в Next.js: сделку создаёт и
 * воркер (клиент написал), и панель (менеджер двигает карточку).
 */

export type StageKind = 'NEW' | 'WORK' | 'ORDER' | 'WON' | 'LOST';
export const CLOSED_KINDS: StageKind[] = ['WON', 'LOST'];

/** Клиент, который недавно купил или отказался, пишет «спасибо» — новую сделку не заводим. */
const REOPEN_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** Причины отказа на выбор — плюс свободный текст. */
export const LOST_REASONS = ['Дорого', 'Нет размера или модели', 'Купил в другом месте', 'Не отвечает', 'Передумал'];

export class CrmError extends Error {}

/** Сумма в тенге с пробелами: 12 500 ₸. */
export function formatMoney(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return '—';
  return `${new Intl.NumberFormat('ru-RU').format(amount).replace(/[\u00a0\u202f]/g, ' ')} ₸`;
}

/** «12 500», «12500 тг», «12.500» → 12500. Мусор → null. */
export function parseAmount(raw: unknown): number | null {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number.parseInt(digits.slice(0, 10), 10);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000_000 ? n : null;
}

export type StageMoveInput = { amount?: number | null; product?: string | null; lostReason?: string | null };

/** Что обязательно для перехода на этап. null — можно. */
export function stageMoveProblem(kind: StageKind, input: StageMoveInput): string | null {
  if (kind === 'ORDER') {
    if (!input.amount) return 'Укажите сумму заказа';
    if (!input.product?.trim()) return 'Укажите товар';
  }
  if (kind === 'LOST' && !input.lostReason?.trim()) return 'Укажите причину отказа';
  return null;
}

/** Этапы компании; если их нет (старая компания, тесты) — создаются по умолчанию. */
export async function ensureStages(db: TenantClient) {
  const stages = await db.pipelineStage.findMany({ orderBy: { position: 'asc' } });
  if (stages.length > 0) return stages;
  await db.pipelineStage.createMany({ data: DEFAULT_STAGES.map((s) => ({ ...s })) as never });
  return db.pipelineStage.findMany({ orderBy: { position: 'asc' } });
}

/**
 * Открытая сделка клиента или новая на этапе «Новый». Вызывается на каждое
 * входящее: сделка заводится сама, вручную создавать ничего не нужно.
 * Возвращает null, если клиент недавно закрыл сделку и пишет вдогонку.
 */
export async function ensureOpenDeal(
  db: TenantClient,
  input: { customerId: string; conversationId: string | null; at?: Date },
) {
  const open = await db.deal.findFirst({
    where: { customerId: input.customerId, stage: { kind: { notIn: CLOSED_KINDS } } },
    orderBy: { createdAt: 'desc' },
  });
  if (open) {
    if (!open.conversationId && input.conversationId) {
      await db.deal.updateMany({ where: { id: open.id }, data: { conversationId: input.conversationId } });
    }
    return open;
  }

  const lastClosed = await db.deal.findFirst({
    where: { customerId: input.customerId },
    orderBy: { updatedAt: 'desc' },
    select: { wonAt: true, lostAt: true },
  });
  const closedAt = lastClosed?.wonAt ?? lastClosed?.lostAt;
  if (closedAt && Date.now() - closedAt.getTime() < REOPEN_AFTER_MS) return null;

  const stages = await ensureStages(db);
  const first = stages.find((s) => s.kind === 'NEW') ?? stages[0]!;
  const at = input.at ?? new Date();
  const deal = await db.deal.create({
    data: {
      customerId: input.customerId,
      conversationId: input.conversationId,
      stageId: first.id,
      stageChangedAt: at,
      createdAt: at,
    } as never,
  });
  await db.dealEvent.create({
    data: { dealId: deal.id, type: 'created', text: lastClosed ? 'Клиент написал снова — новая сделка' : 'Клиент написал впервые' } as never,
  });
  return deal;
}

/**
 * Перенос сделки на этап. Заказ требует сумму и товар, отказ — причину.
 * Даты ключевых событий ставятся один раз: по ним считается конверсия.
 */
export async function moveDeal(
  db: TenantClient,
  input: { dealId: string; stageId: string; actorUserId?: string | null } & StageMoveInput & { comment?: string | null },
) {
  const [deal, stage] = await Promise.all([
    db.deal.findFirst({ where: { id: input.dealId }, include: { stage: true } }),
    db.pipelineStage.findFirst({ where: { id: input.stageId } }),
  ]);
  if (!deal || !stage) throw new CrmError('Сделка или этап не найдены');

  const amount = input.amount ?? deal.amount;
  const product = input.product?.trim() || deal.product;
  const lostReason = input.lostReason?.trim() || null;
  const problem = stageMoveProblem(stage.kind as StageKind, { amount, product, lostReason });
  if (problem) throw new CrmError(problem);

  const now = new Date();
  const kind = stage.kind as StageKind;
  await db.deal.updateMany({
    where: { id: deal.id },
    data: {
      stageId: stage.id,
      stageChangedAt: deal.stageId === stage.id ? deal.stageChangedAt : now,
      amount,
      product,
      ...(input.comment !== undefined ? { comment: input.comment?.trim() || null } : {}),
      // Выдан — значит, и заказ был: иначе выручка мимо аналитики.
      ...(kind === 'ORDER' || kind === 'WON' ? { orderedAt: deal.orderedAt ?? now } : {}),
      ...(kind === 'WON' ? { wonAt: deal.wonAt ?? now, lostAt: null, lostReason: null } : {}),
      ...(kind === 'LOST' ? { lostAt: now, lostReason } : {}),
      // Вернули из отказа в работу — отказ больше не считается.
      ...(kind !== 'LOST' && deal.lostAt ? { lostAt: null, lostReason: null } : {}),
    },
  });

  if (deal.stageId !== stage.id || kind === 'ORDER') {
    const text =
      kind === 'ORDER' ? `Новый заказ: ${product} — ${formatMoney(amount)}`
      : kind === 'LOST' ? `Отказ: ${lostReason}`
      : `Этап: ${deal.stage.name} → ${stage.name}`;
    await db.dealEvent.create({
      data: {
        dealId: deal.id,
        actorUserId: input.actorUserId ?? null,
        type: kind === 'ORDER' ? 'order' : kind === 'LOST' ? 'lost' : 'stage',
        text,
        data: { from: deal.stageId, to: stage.id },
      } as never,
    });
  }
  return { kind, stageName: stage.name };
}

/**
 * Передать клиента менеджеру: сделка уходит на первый этап «в работе»,
 * диалог — менеджеру, ассистент в нём замолкает.
 */
export async function assignDeal(
  db: TenantClient,
  input: { dealId: string; assigneeId: string; assigneeName: string; actorUserId?: string | null },
) {
  const deal = await db.deal.findFirst({ where: { id: input.dealId }, include: { stage: true } });
  if (!deal) throw new CrmError('Сделка не найдена');

  const stages = await ensureStages(db);
  const work = stages.find((s) => s.kind === 'WORK');
  const now = new Date();
  const moveToWork = deal.stage.kind === 'NEW' && work;

  await db.deal.updateMany({
    where: { id: deal.id },
    data: {
      assigneeId: input.assigneeId,
      assignedAt: now,
      ...(moveToWork ? { stageId: work.id, stageChangedAt: now } : {}),
    },
  });
  await db.dealEvent.create({
    data: {
      dealId: deal.id,
      actorUserId: input.actorUserId ?? null,
      type: 'assigned',
      text: `Передан менеджеру: ${input.assigneeName}`,
      data: { assigneeId: input.assigneeId },
    } as never,
  });

  if (deal.conversationId) {
    await db.conversation.updateMany({
      where: { id: deal.conversationId },
      data: { assigneeId: input.assigneeId, mode: 'HUMAN' },
    });
    await db.message.create({
      data: {
        conversationId: deal.conversationId,
        direction: 'OUTBOUND',
        authorType: 'SYSTEM',
        authorUserId: input.actorUserId ?? null,
        text: `Клиент передан менеджеру ${input.assigneeName} — ассистент в этом диалоге больше не отвечает`,
        status: 'SENT',
        sentAt: now,
      } as never,
    });
  }
}

/* ── Аналитика ─────────────────────────────────────────────── */

export type FunnelDeal = {
  createdAt: Date;
  assignedAt: Date | null;
  orderedAt: Date | null;
  wonAt: Date | null;
  lostAt: Date | null;
  amount: number | null;
  lostReason: string | null;
  assigneeId: string | null;
};

/**
 * Воронка за период: сколько сделок дошло до каждого шага. Считается по
 * датам событий в периоде — заказ, оформленный в этом месяце по клиенту
 * из прошлого, тоже идёт в этот месяц.
 */
export function funnel(deals: FunnelDeal[], from: Date, to: Date) {
  const inRange = (d: Date | null) => !!d && d >= from && d < to;
  const created = deals.filter((d) => inRange(d.createdAt)).length;
  const assigned = deals.filter((d) => inRange(d.assignedAt)).length;
  const orderedDeals = deals.filter((d) => inRange(d.orderedAt));
  const ordered = orderedDeals.length;
  const won = deals.filter((d) => inRange(d.wonAt)).length;
  const lostDeals = deals.filter((d) => inRange(d.lostAt));
  const revenue = orderedDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  const reasons = new Map<string, number>();
  for (const d of lostDeals) reasons.set(d.lostReason ?? 'Без причины', (reasons.get(d.lostReason ?? 'Без причины') ?? 0) + 1);

  return {
    created,
    assigned,
    ordered,
    won,
    lost: lostDeals.length,
    revenue,
    averageCheck: ordered ? Math.round(revenue / ordered) : 0,
    /** Конверсия обращения в заказ, %. */
    conversion: created ? Math.round((ordered / created) * 1000) / 10 : 0,
    lostReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
  };
}
