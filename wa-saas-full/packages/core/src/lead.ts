/**
 * Заявка на покупку: бот готовит продажу — по ходу разговора собирает имя,
 * что хочет, размер, город, доставку/адрес и оплату. Помнит, что клиент уже
 * сказал (хранится в сделке), и спрашивает только недостающее, по порядку.
 * Всё собрано — менеджеру уходит готовая заявка.
 */
import type { Understanding } from './ai/understand.js';

export type Lead = { name: string; want: string; size: string; city: string; delivery: string; address: string; payment: string };
export type LeadField = keyof Lead;

/** Порядок вопросов, как решил владелец: имя → что хочет → размер → город → доставка/адрес → оплата. */
export const LEAD_ORDER: LeadField[] = ['name', 'want', 'size', 'city', 'delivery', 'address', 'payment'];

export const emptyLead = (): Lead => ({ name: '', want: '', size: '', city: '', delivery: '', address: '', payment: '' });

/** Из JSON сделки — только строки известных полей. */
export function toLead(raw: unknown): Lead {
  const lead = emptyLead();
  if (raw && typeof raw === 'object') {
    for (const f of LEAD_ORDER) {
      const v = (raw as Record<string, unknown>)[f];
      if (typeof v === 'string') lead[f] = v.trim().slice(0, 200);
    }
  }
  return lead;
}

/** Что из сообщения клиента идёт в заявку. */
export function leadFromUnderstanding(u: Understanding | null | undefined): Partial<Lead> {
  if (!u) return {};
  const size = u.size ? u.size.replace(',', '.').match(/\d{1,2}(?:\.5)?/)?.[0] ?? u.size : '';
  const want = u.article
    ? `арт. ${u.article}${u.model ? `, ${u.model}` : ''}`
    : u.model || [u.kind, u.season, u.color].filter(Boolean).join(', ');
  return { name: u.name ?? '', want, size, city: u.city, delivery: u.delivery, address: u.address ?? '', payment: u.payment };
}

/** Новое сказанное клиентом поверх старого; пустое старое не стирает. */
export function mergeLead(base: Lead, add: Partial<Lead>): Lead {
  const out = { ...base };
  for (const f of LEAD_ORDER) {
    const v = add[f]?.trim();
    if (v) out[f] = v.slice(0, 200);
  }
  return out;
}

export const isPickup = (delivery: string) =>
  /самовывоз|заберу|сам(а)? (заберу|приду|приеду)|в магазин|из магазин|дүкен|өзім|барып алам|келіп алам|приду|приеду/i.test(delivery);

/** Чего не хватает, по порядку. Адрес — для доставки; для самовывоза — в какой магазин. */
export function leadMissing(lead: Lead): LeadField[] {
  return LEAD_ORDER.filter((f) => {
    if (f === 'address') return !!lead.delivery && !lead.address;
    return !lead[f];
  });
}

export const leadStarted = (lead: Lead) => LEAD_ORDER.some((f) => !!lead[f]);

const LABEL: Record<LeadField, string> = {
  name: 'имя',
  want: 'какую модель или что именно ищет',
  size: 'размер',
  city: 'город',
  delivery: 'доставка или самовывоз из магазина',
  address: 'адрес доставки',
  payment: 'как удобнее оплатить',
};

const fieldLabel = (f: LeadField, lead: Lead) => (f === 'address' && isPickup(lead.delivery) ? 'в какой магазин придёт' : LABEL[f]);

/** Строки заявки — для менеджера и для карточки клиента. */
export function leadLines(lead: Lead): string[] {
  const rows: Array<[string, string]> = [
    ['Имя', lead.name],
    ['Что хочет', lead.want],
    ['Размер', lead.size],
    ['Город', lead.city],
    ['Получение', lead.delivery],
    [isPickup(lead.delivery) ? 'Магазин' : 'Адрес', lead.address],
    ['Оплата', lead.payment],
  ];
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
}

/**
 * Подсказка модели: что уже известно и что спросить сейчас. Сначала ответ на
 * вопрос клиента, потом 1–2 следующих пункта — не анкета разом.
 */
export function leadNote(lead: Lead) {
  const missing = leadMissing(lead);
  if (!missing.length) return '';
  const known = leadLines(lead);
  const ask = missing.slice(0, 2).map((f) => fieldLabel(f, lead));
  return [
    '(Подготовка продажи. Сначала коротко и по сути ответь на вопрос клиента — 1–2 предложения, без лишнего. Если клиент просто ответил на твой вопрос (назвал имя, размер, город) — коротко поблагодари; это не повод звать менеджера.',
    known.length ? `Уже известно — не переспрашивай: ${known.join('; ')}.` : '',
    `Затем спроси, чего не хватает для заказа: ${ask.join(' и ')}. Не больше этих пунктов, без анкеты и без предложения брони.`,
    missing[0] === 'payment' ? 'Способы оплаты назови из базы знаний.' : '',
    ')',
  ].filter(Boolean).join(' ');
}
