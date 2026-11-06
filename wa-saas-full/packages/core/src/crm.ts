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

/** Свой список компании или стандартный, если свой не задан. */
export function lostReasonsOf(company: { lostReasons?: string[] | null }) {
  const own = (company.lostReasons ?? []).map((r) => r.trim()).filter(Boolean);
  return own.length ? own : LOST_REASONS;
}

/** Чистит список причин: без пустых и повторов, не длиннее 40 символов, максимум 12. */
export function cleanLostReasons(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const r = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!r || seen.has(r.toLowerCase())) continue;
    seen.add(r.toLowerCase());
    out.push(r);
  }
  return out.slice(0, 12);
}

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
    where: { customerId: input.customerId, archivedAt: null, stage: { kind: { notIn: CLOSED_KINDS } } },
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
      // Сделка закрыта — напоминать больше не о чем.
      ...(kind === 'WON' || kind === 'LOST' ? { remindAt: null, remindNote: null } : {}),
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
  input: { dealId: string; assigneeId: string; assigneeName: string; actorUserId?: string | null; auto?: boolean },
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
      text: input.auto ? `Передан по очереди менеджеру на смене: ${input.assigneeName}` : `Передан менеджеру: ${input.assigneeName}`,
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
        text: input.auto
          ? `Клиент передан по очереди менеджеру ${input.assigneeName} (на смене) — ассистент в этом диалоге больше не отвечает`
          : `Клиент передан менеджеру ${input.assigneeName} — ассистент в этом диалоге больше не отвечает`,
        status: 'SENT',
        sentAt: now,
      } as never,
    });
  }
}

/* ── Этапы: тип, порядок, удаление ─────────────────────────── */

export type StageDraft = { id?: string | null; name: string; kind: StageKind };

const MAX_STAGES = 12;

/** Что не так с новым списком этапов. null — можно сохранять. */
export function stagesProblem(draft: StageDraft[], newStageId: string | null): string | null {
  if (draft.length < 3) return 'Нужно хотя бы три этапа: «Новый», «Купил» и «Отказ»';
  if (draft.length > MAX_STAGES) return `Больше ${MAX_STAGES} этапов — воронку трудно читать`;
  const first = draft[0]!;
  if (first.kind !== 'NEW' || (newStageId && first.id !== newStageId)) return 'Первым всегда идёт этап, куда попадают новые клиенты';
  if (draft.slice(1).some((s) => s.kind === 'NEW')) return 'Этап для новых клиентов может быть только один';
  if (!draft.some((s) => s.kind === 'WON')) return 'Нужен хотя бы один этап с типом «Купил»';
  if (!draft.some((s) => s.kind === 'LOST')) return 'Нужен хотя бы один этап с типом «Отказ»';
  const seen = new Set<string>();
  for (const s of draft) {
    const name = s.name.trim();
    if (!name) return 'У каждого этапа должно быть название';
    if (name.length > 40) return `Слишком длинное название: «${name.slice(0, 20)}…»`;
    const key = name.toLowerCase();
    if (seen.has(key)) return `Два этапа называются «${name}» — переименуйте один`;
    seen.add(key);
  }
  return null;
}

/**
 * Сделки этапа, у которого поменялся тип: даты событий приводим в порядок,
 * иначе аналитика считала бы покупки там, где клиент просто «думает».
 */
export async function fitDealsToKind(db: TenantClient, stageId: string, kind: StageKind) {
  const deals = await db.deal.findMany({
    where: { stageId },
    select: { id: true, stageChangedAt: true, amount: true, orderedAt: true, wonAt: true, lostAt: true },
  });
  for (const d of deals) {
    const at = d.stageChangedAt;
    const data =
      kind === 'WON'
        ? { orderedAt: d.orderedAt ?? at, wonAt: d.wonAt ?? at, lostAt: null, lostReason: null, remindAt: null, remindNote: null }
        : kind === 'LOST'
          ? { lostAt: d.lostAt ?? at, wonAt: null, remindAt: null, remindNote: null }
          : kind === 'ORDER'
            ? { orderedAt: d.orderedAt ?? at, wonAt: null, lostAt: null, lostReason: null }
            : { wonAt: null, lostAt: null, lostReason: null, ...(d.amount ? {} : { orderedAt: null }) };
    await db.deal.updateMany({ where: { id: d.id }, data });
  }
  return deals.length;
}

/**
 * Сохранить этапы целиком: названия, типы, порядок, новые и удалённые.
 * Сделки удалённого этапа уходят на ближайший оставшийся этап выше.
 */
export async function saveStages(db: TenantClient, draft: StageDraft[]) {
  const current = await ensureStages(db);
  const newStage = current.find((s) => s.kind === 'NEW') ?? null;
  const known = new Set(current.map((s) => s.id));
  const clean = draft.map((s) => ({ id: s.id && known.has(s.id) ? s.id : null, name: s.name.trim(), kind: s.kind }));
  const problem = stagesProblem(clean, newStage?.id ?? null);
  if (problem) throw new CrmError(problem);

  // Сначала создаём новые и обновляем старые — удалённым будет куда отдать сделки.
  const ids: string[] = [];
  const changedKind: Array<{ id: string; kind: StageKind }> = [];
  for (const [position, s] of clean.entries()) {
    if (s.id) {
      const before = current.find((c) => c.id === s.id)!;
      await db.pipelineStage.updateMany({ where: { id: s.id }, data: { name: s.name, kind: s.kind, position } });
      if (before.kind !== s.kind) changedKind.push({ id: s.id, kind: s.kind });
      ids.push(s.id);
    } else {
      const created = await db.pipelineStage.create({ data: { name: s.name, kind: s.kind, position } as never });
      ids.push(created.id);
    }
  }
  for (const c of changedKind) await fitDealsToKind(db, c.id, c.kind);

  const kept = new Set(ids);
  for (const [i, old] of current.entries()) {
    if (kept.has(old.id)) continue;
    // Ближайший оставшийся этап выше в старом порядке, иначе — «Новый».
    const target = current.slice(0, i).reverse().find((c) => kept.has(c.id)) ?? current.find((c) => kept.has(c.id))!;
    const moved = await db.deal.updateMany({ where: { stageId: old.id }, data: { stageId: target.id } });
    if (moved.count > 0) {
      const kind = clean[ids.indexOf(target.id)]!.kind;
      await fitDealsToKind(db, target.id, kind);
    }
    await db.pipelineStage.deleteMany({ where: { id: old.id } });
  }
}

/* ── Зависшие и напоминания ────────────────────────────────── */

/**
 * Клиент завис: сделка в работе, а ни этап, ни переписка не двигались
 * дольше порога. «Новый» у бота не считается — там отвечает ассистент;
 * будущее напоминание — тоже: менеджер сам решил вернуться позже.
 */
export function isStale(
  deal: { stageKind: StageKind; stageChangedAt: Date; lastMessageAt?: Date | null; remindAt?: Date | null; botActive?: boolean },
  hours: number,
  now = new Date(),
) {
  if (deal.stageKind === 'WON' || deal.stageKind === 'LOST') return false;
  if (deal.stageKind === 'NEW' && deal.botActive) return false;
  if (deal.remindAt && deal.remindAt > now) return false;
  const last = Math.max(deal.stageChangedAt.getTime(), deal.lastMessageAt?.getTime() ?? 0);
  return now.getTime() - last > Math.max(1, hours) * 3600_000;
}

/* ── Смены и авто-распределение ────────────────────────────── */

/** Панель закрыта дольше — менеджер не получает новых клиентов. */
export const SHIFT_IDLE_MS = 15 * 60 * 1000;
/** Забыл закончить смену — она закрывается сама. */
export const SHIFT_MAX_MS = 14 * 60 * 60 * 1000;

export function onShiftNow(
  m: { onShift: boolean; shiftStartedAt: Date | null; lastSeenAt: Date | null },
  now = new Date(),
) {
  if (!m.onShift || !m.shiftStartedAt || !m.lastSeenAt) return false;
  if (now.getTime() - m.shiftStartedAt.getTime() > SHIFT_MAX_MS) return false;
  return now.getTime() - m.lastSeenAt.getTime() <= SHIFT_IDLE_MS;
}

/**
 * Передать нового клиента следующему менеджеру на смене — по очереди: кто
 * дольше всех не получал клиента. Работает, только если в компании включено
 * авто-распределение. Никого нет на смене — клиент ждёт без менеджера.
 */
export async function autoAssignConversation(
  db: TenantClient,
  input: { companyId: string; conversationId: string },
): Promise<{ assigneeId: string; name: string } | null> {
  const company = await db.company.findFirst({ where: { id: input.companyId }, select: { autoAssign: true } });
  if (!company?.autoAssign) return null;

  const deal = await db.deal.findFirst({
    where: { conversationId: input.conversationId, archivedAt: null, stage: { kind: { notIn: CLOSED_KINDS } } },
    orderBy: { createdAt: 'desc' },
  });
  if (!deal || deal.assigneeId) return null;

  const now = new Date();
  const members = await db.membership.findMany({
    where: { onShift: true, role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'] } },
    include: { user: true },
  });
  const queue = members
    .filter((m) => onShiftNow(m, now))
    .sort((a, b) => (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0));

  for (const m of queue) {
    // Двое клиентов пришли одновременно — второй достанется следующему.
    const claimed = await db.membership.updateMany({
      where: { id: m.id, lastAssignedAt: m.lastAssignedAt },
      data: { lastAssignedAt: now },
    });
    if (claimed.count === 0) continue;
    const name = `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email;
    await assignDeal(db, { dealId: deal.id, assigneeId: m.userId, assigneeName: name, auto: true });
    return { assigneeId: m.userId, name };
  }
  return null;
}

/* ── Реклама ───────────────────────────────────────────────── */

export type AdInfo = { sourceType?: string; sourceId?: string; sourceUrl?: string; headline?: string };

/** Клиент пришёл с рекламы — записываем в сделку, если ещё не записано. */
export async function recordAdSource(db: TenantClient, dealId: string, ad: AdInfo) {
  await db.deal.updateMany({
    where: { id: dealId, adSourceId: null, adHeadline: null },
    data: {
      source: 'ad',
      adSourceType: ad.sourceType ?? null,
      adSourceId: ad.sourceId ?? null,
      adSourceUrl: ad.sourceUrl ?? null,
      adHeadline: ad.headline ?? (ad.sourceId ? `Объявление ${ad.sourceId}` : 'Реклама'),
    },
  });
}

/** Подпись источника для таблиц и карточки. */
export function sourceLabel(deal: { source: string; adHeadline?: string | null }) {
  return deal.source === 'ad' ? deal.adHeadline || 'Реклама' : 'WhatsApp напрямую';
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
  /** info — просто вопрос, spam — спам: в конверсию не идут. */
  archiveReason?: string | null;
};

/**
 * Воронка за период: сколько сделок дошло до каждого шага. Считается по
 * датам событий в периоде — заказ, оформленный в этом месяце по клиенту
 * из прошлого, тоже идёт в этот месяц.
 */
export function funnel(deals: FunnelDeal[], from: Date, to: Date) {
  const inRange = (d: Date | null) => !!d && d >= from && d < to;
  // «Просто вопрос» и спам — не продажи: в обращения для конверсии не идут.
  const questions = deals.filter((d) => inRange(d.createdAt) && d.archiveReason === 'info').length;
  const spam = deals.filter((d) => inRange(d.createdAt) && d.archiveReason === 'spam').length;
  const created = deals.filter((d) => inRange(d.createdAt) && !d.archiveReason).length;
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
    questions,
    spam,
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
