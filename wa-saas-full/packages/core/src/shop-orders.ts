import type { TenantClient } from '@wa/db';
import { CLOSED_KINDS, CrmError, ensureStages, formatMoney, moveDeal, type StageKind } from './crm.js';

/**
 * Интернет-заказы из склада SHOQAI.
 *
 * Источник правды — склад: продавцы оформляют там заказ (телефон, товары,
 * сумма), и склад присылает его сюда при создании и каждой смене статуса.
 * Здесь заказ привязывается к клиенту WhatsApp по номеру, сделка сама
 * переходит на нужный этап, а ассистент знает, что клиент купил и где
 * его посылка. Менеджеру ничего не нужно переписывать в CRM.
 */

export const SHOP_STATUSES = ['draft', 'paid', 'assembled', 'shipped', 'completed', 'returned', 'cancelled'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

/** Как статус называется для людей (и для клиента в ответе бота). */
export const SHOP_STATUS_NAME: Record<ShopStatus, string> = {
  draft: 'оформлен, ждём оплату',
  paid: 'оплачен, собираем',
  assembled: 'собран, скоро отправим',
  shipped: 'отправлен',
  completed: 'получен клиентом',
  returned: 'возврат',
  cancelled: 'отменён',
};

/** Этап воронки, на который ведёт статус заказа. */
export function stageKindForStatus(status: ShopStatus): StageKind {
  if (status === 'completed') return 'WON';
  if (status === 'cancelled' || status === 'returned') return 'LOST';
  return 'ORDER';
}

/** Ключ сравнения номеров: последние 10 цифр (+7 701…, 8 701…, 7701… — одно и то же). */
export function phoneKey(phone: unknown): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

export type ShopItem = { name: string; size: string; qty: number; sum: number };
export type ShopOrderInput = {
  id: string;
  number: string | null;
  phone: string;
  clientName: string | null;
  status: ShopStatus;
  items: ShopItem[];
  total: number;
  source: string | null;
  sellerName: string | null;
  city: string | null;
  carrier: string | null;
  track: string | null;
  trackUrl: string | null;
  orderedAt: Date;
  shippedAt: Date | null;
};

const str = (v: unknown, max = 200) => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s ? s.slice(0, max) : null;
};
const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n < 1_000_000_000 ? n : 0;
};
const date = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Проверка того, что прислал склад. Возвращает заказ или текст ошибки. */
export function parseShopOrder(raw: unknown): ShopOrderInput | string {
  if (!raw || typeof raw !== 'object') return 'заказ не объект';
  const o = raw as Record<string, unknown>;
  const id = str(o.id, 120);
  if (!id) return 'нет id заказа';
  const phone = str(o.phone, 40);
  if (!phone) return `заказ ${id}: нет телефона`;
  const status = String(o.status ?? '') as ShopStatus;
  if (!SHOP_STATUSES.includes(status)) return `заказ ${id}: неизвестный статус «${String(o.status ?? '')}»`;
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 50).map((x) => {
    const i = (x ?? {}) as Record<string, unknown>;
    return { name: str(i.name, 160) ?? 'Товар', size: str(i.size, 20) ?? '', qty: Math.max(1, int(i.qty) || 1), sum: int(i.sum) };
  });
  return {
    id, phone, status, items,
    number: str(o.number, 40),
    clientName: str(o.clientName, 120),
    total: int(o.total),
    source: str(o.source, 60),
    sellerName: str(o.sellerName, 120),
    city: str(o.city, 120),
    carrier: str(o.carrier, 60),
    track: str(o.track, 80),
    // Ссылка уходит клиенту и в панель — только обычный веб-адрес.
    trackUrl: /^https?:\/\//i.test(str(o.trackUrl, 300) ?? '') ? str(o.trackUrl, 300) : null,
    orderedAt: date(o.createdAt) ?? new Date(),
    shippedAt: date(o.shippedAt),
  };
}

/** «Кеды 99 хаки, р. 41 ×2; Ботинки 7, р. 42» — для сделки и истории. */
export function itemsText(items: ShopItem[], max = 300) {
  const t = items.map((i) => `${i.name}${i.size ? `, р. ${i.size}` : ''}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join('; ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const orderLabel = (o: { number: string | null; id: string }) => (o.number ? `№${o.number}` : `из склада`);

/** Статусы склада так, как их видят люди в складе. */
export const SHOP_STATUS_LABEL: Record<ShopStatus, string> = {
  draft: 'Новый (ждём оплату)', paid: 'Оплачен', assembled: 'Собран', shipped: 'Отправлен',
  completed: 'Выкуплен', cancelled: 'Отменён', returned: 'Возврат',
};

/**
 * Какой статус заказа на какой этап воронки ведёт: id этапа или 'none' —
 * «не менять этап». Чего нет в сохранённом — угадываем по названиям этапов.
 */
export type StageMap = Partial<Record<ShopStatus, string>>;
type StageLite = { id: string; name: string; kind: string; position: number };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/**
 * Этапы у всех свои: «Ждем оплату», «Продажа», «Выкупил». Сначала ищем по
 * названию, потом по типу этапа. Раньше брали только тип «Заказ» — у кого
 * такого этапа не было, сделка из склада не двигалась вовсе.
 */
export function guessStageMap(stages: StageLite[]): Record<ShopStatus, string | null> {
  const by = (list: StageLite[], re: RegExp) => list.find((s) => re.test(norm(s.name)))?.id ?? null;
  const won = stages.filter((s) => s.kind === 'WON');
  const lost = stages.filter((s) => s.kind === 'LOST');
  const completed = by(won, /выкуп|выдан|получ|забрал|купил/) ?? won.at(-1)?.id ?? null;
  const open = stages.filter((s) => s.kind !== 'NEW' && s.kind !== 'LOST' && s.id !== completed);
  const orderKind = stages.find((s) => s.kind === 'ORDER')?.id ?? null;
  const draft = by(open.filter((s) => s.kind !== 'WON'), /ждем оплат|ожида\S* оплат|оплат/) ?? orderKind;
  const paid = by(open, /продаж|оплачен|оформлен|заказ/) ?? orderKind ?? draft;
  // «Отправлен каталог» — это про переписку, не про посылку; и посылка не
  // может уехать раньше, чем заказ оплачен — ищем только после «оплачен».
  const paidPos = stages.find((s) => s.id === paid)?.position ?? -1;
  const shipped = by(open.filter((s) => s.position >= paidPos && !/каталог|прайс|фото/.test(norm(s.name))), /отправ|доставк|в пути|посылк/) ?? paid;
  const cancelled = by(lost, /отмен/) ?? lost[0]?.id ?? null;
  const returned = by(lost, /возврат/) ?? cancelled;
  return { draft, paid, assembled: paid, shipped, completed, cancelled, returned };
}

/** Сохранённые настройки поверх догадки; удалённые этапы не мешают. */
export function resolveStageMap(stages: StageLite[], saved?: unknown): Record<ShopStatus, string | null> {
  const guess = guessStageMap(stages);
  const map = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const ids = new Set(stages.map((s) => s.id));
  return Object.fromEntries(SHOP_STATUSES.map((st) => {
    const v = map[st];
    return [st, v === 'none' ? null : typeof v === 'string' && ids.has(v) ? v : guess[st]];
  })) as Record<ShopStatus, string | null>;
}

export type ApplyResult = { id: string; linked: boolean; customerId?: string; dealId?: string; stage?: string; note?: string };

/**
 * Сохранить заказ и двинуть сделку клиента на этап, выбранный для его
 * статуса (stageMap из настроек компании). Повторная отправка того же
 * заказа историю не засоряет — склад может слать сколько угодно.
 */
export async function applyShopOrder(db: TenantClient, input: ShopOrderInput, stageMap?: unknown): Promise<ApplyResult> {
  const key = phoneKey(input.phone);
  const existing = await db.shopOrder.findFirst({ where: { externalId: input.id } });
  // Клиент WhatsApp с тем же номером; если таких несколько — кто писал последним.
  const customer = key
    ? await db.customer.findFirst({ where: { waId: { endsWith: key } }, orderBy: { lastContactAt: 'desc' } })
    : null;

  const data = {
    number: input.number, phone: input.phone, phoneKey: key, clientName: input.clientName,
    status: input.status, items: input.items as never, total: input.total, source: input.source,
    sellerName: input.sellerName, city: input.city, carrier: input.carrier, track: input.track,
    trackUrl: input.trackUrl, orderedAt: input.orderedAt, shippedAt: input.shippedAt,
    customerId: customer?.id ?? null,
  };
  let orderId: string;
  if (existing) {
    await db.shopOrder.updateMany({ where: { id: existing.id }, data });
    orderId = existing.id;
  } else {
    orderId = (await db.shopOrder.create({ data: { externalId: input.id, ...data } as never })).id;
  }
  if (!customer) return { id: input.id, linked: false };

  // Имя из заказа — если у клиента в WhatsApp его не было.
  if (!customer.name && input.clientName) {
    await db.customer.updateMany({ where: { id: customer.id }, data: { name: input.clientName } });
  }

  // Повтор без изменений этап всё равно сверяет: так «Отправить за 30 дней»
  // догоняет сделки, которые раньше не сдвинулись. В историю — только новое.
  const statusChanged = !existing || existing.status !== input.status || existing.total !== input.total;

  // Сделка: та, что уже связана с заказом, иначе открытая у клиента,
  // иначе новая — клиент мог купить через неделю после закрытой сделки.
  let deal = existing?.dealId
    ? await db.deal.findFirst({ where: { id: existing.dealId }, include: { stage: true } })
    : null;
  if (!deal) {
    deal = await db.deal.findFirst({
      where: { customerId: customer.id, archivedAt: null, stage: { kind: { notIn: CLOSED_KINDS } } },
      orderBy: { createdAt: 'desc' }, include: { stage: true },
    });
  }
  const stages = await ensureStages(db);
  const targetId = resolveStageMap(stages, stageMap)[input.status];
  const stage = targetId ? stages.find((s) => s.id === targetId) : undefined;
  const target = stage?.kind as StageKind | undefined;
  if (!deal) {
    // Отменённый заказ без сделки — заводить отказ не из чего.
    if (!stage || target === 'LOST') {
      return { id: input.id, linked: true, customerId: customer.id, note: stage ? 'отменён до сделки' : 'этап для статуса не выбран' };
    }
    const conv = await db.conversation.findFirst({ where: { customerId: customer.id }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } });
    const first = stages.find((s) => s.kind === 'NEW') ?? stages[0]!;
    const created = await db.deal.create({
      data: { customerId: customer.id, conversationId: conv?.id ?? null, stageId: first.id } as never,
    });
    await db.dealEvent.create({ data: { dealId: created.id, type: 'created', text: `Заказ ${orderLabel(input)} оформлен в складе` } as never });
    deal = await db.deal.findFirst({ where: { id: created.id }, include: { stage: true } });
  }
  if (!deal) return { id: input.id, linked: true, customerId: customer.id };
  if (existing?.dealId !== deal.id) await db.shopOrder.updateMany({ where: { id: orderId }, data: { dealId: deal.id } });

  const current = deal.stage;
  const currentKind = current.kind as StageKind;
  const product = itemsText(input.items) || 'Товар';
  const label = orderLabel(input);
  let note: string | undefined;

  // Только вперёд по воронке. Выкупленную сделку не трогаем (возврат после
  // выкупа — запись в истории); из отказа новый заказ возвращает в работу.
  let skip = !stage || stage.id === current.id;
  if (!skip && stage) {
    if (currentKind === 'WON') skip = target !== 'WON' || stage.position < current.position;
    else if (currentKind === 'LOST') skip = target === 'LOST';
    else if (target !== 'LOST' && target !== 'WON') skip = stage.position < current.position;
  }
  if (!skip && stage) {
    try {
      await moveDeal(db, {
        dealId: deal.id, stageId: stage.id, amount: input.total || deal.amount || null, product,
        lostReason: target === 'LOST' ? (input.status === 'returned' ? `Возврат по заказу ${label}` : `Заказ ${label} отменён`) : null,
      });
    } catch (e) {
      if (!(e instanceof CrmError)) throw e;
      note = e.message;
    }
  } else if (currentKind !== 'WON' && currentKind !== 'LOST' && input.total && input.total !== deal.amount) {
    await db.deal.updateMany({ where: { id: deal.id }, data: { amount: input.total, product } });
  }
  if (statusChanged) {
    await db.dealEvent.create({
      data: {
        dealId: deal.id, type: 'note',
        text: `Склад: заказ ${label} — ${SHOP_STATUS_NAME[input.status]}, ${formatMoney(input.total)}` +
          (input.track ? `, трек ${input.track}` : '') + (input.sellerName ? ` (${input.sellerName})` : '') +
          (note ? `. Этап не сменился: ${note}` : ''),
        data: { shopOrder: input.id, status: input.status },
      } as never,
    });
  }
  return { id: input.id, linked: true, customerId: customer.id, dealId: deal.id, stage: skip ? deal.stage.name : stage?.name };
}

type OrderForAi = { number: string | null; externalId: string; status: string; items: unknown; total: number;
  carrier: string | null; track: string | null; trackUrl: string | null; orderedAt: Date; shippedAt: Date | null };

/**
 * Блок для ассистента: последние заказы клиента. Только факты из склада —
 * бот отвечает по ним на «где мой заказ?», ничего не обещая сверх этого.
 */
export function shopOrdersBlock(orders: OrderForAi[], now = new Date()): string {
  if (!orders.length) return '';
  const day = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' });
  const lines = orders.slice(0, 5).map((o) => {
    const items = Array.isArray(o.items) ? itemsText(o.items as ShopItem[], 200) : '';
    const status = SHOP_STATUS_NAME[o.status as ShopStatus] ?? o.status;
    return `- Заказ ${o.number ? `№${o.number}` : ''} от ${day(o.orderedAt)}: ${items || 'товары не указаны'} — ${formatMoney(o.total)}. Статус: ${status}` +
      (o.shippedAt ? `, отправлен ${day(o.shippedAt)}` : '') +
      (o.carrier ? (/курьер/i.test(o.carrier) ? `, передан курьеру (трека нет — курьер свяжется сам)` : `, ${o.carrier}`) : '') +
      (o.track ? `, трек ${o.track}` : o.carrier && !/курьер|автобус/i.test(o.carrier) && o.status === 'shipped' ? ', трек пока не указан' : '') +
      (o.trackUrl ? `, отследить: ${o.trackUrl}` : '');
  });
  return `ЗАКАЗЫ ЭТОГО КЛИЕНТА (из склада, на ${day(now)}):\n${lines.join('\n')}`;
}
