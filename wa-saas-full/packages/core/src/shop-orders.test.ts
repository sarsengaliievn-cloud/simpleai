import { describe, it, expect } from 'vitest';
import { phoneKey, parseShopOrder, stageKindForStatus, itemsText, shopOrdersBlock, applyShopOrder, guessStageMap, resolveStageMap, type ShopOrderInput } from './shop-orders.js';
import { ORDER_STATUS_Q } from './ai/rag.js';

describe('заказы из склада: разбор', () => {
  it('номер сравнивается по последним 10 цифрам', () => {
    expect(phoneKey('+7 (701) 123-45-67')).toBe('7011234567');
    expect(phoneKey('87011234567')).toBe('7011234567');
    expect(phoneKey('77011234567')).toBe('7011234567');
    expect(phoneKey('12345')).toBe('');
  });
  it('проверяет заказ и чистит поля', () => {
    expect(parseShopOrder({ id: 'o1', status: 'paid' })).toMatch(/телефона/);
    expect(parseShopOrder({ id: 'o1', phone: '8701', status: 'lost' })).toMatch(/статус/);
    const o = parseShopOrder({ id: 'o1', number: 148, phone: '8 701 123 45 67', status: 'shipped', total: '29900',
      items: [{ name: 'Кеды 99 хаки', size: 41, qty: 0, sum: 29900 }], createdAt: 1794500000000, track: 'RR123KZ' });
    expect(typeof o).toBe('object');
    if (typeof o === 'string') return;
    expect(o.number).toBe('148');
    expect(o.total).toBe(29900);
    expect(o.items[0]).toEqual({ name: 'Кеды 99 хаки', size: '41', qty: 1, sum: 29900 });
    expect(o.orderedAt.getTime()).toBe(1794500000000);
  });
  it('статус → этап воронки', () => {
    expect(stageKindForStatus('draft')).toBe('ORDER');
    expect(stageKindForStatus('shipped')).toBe('ORDER');
    expect(stageKindForStatus('completed')).toBe('WON');
    expect(stageKindForStatus('cancelled')).toBe('LOST');
    expect(stageKindForStatus('returned')).toBe('LOST');
  });
  it('товары одной строкой', () => {
    expect(itemsText([{ name: 'Кеды 99', size: '41', qty: 2, sum: 0 }, { name: 'Носки', size: '', qty: 1, sum: 0 }])).toBe('Кеды 99, р. 41 ×2; Носки');
  });
  it('блок для бота: статус и трек', () => {
    const b = shopOrdersBlock([{ number: '148', externalId: 'o1', status: 'shipped', items: [{ name: 'Кеды 99', size: '41', qty: 1, sum: 29900 }],
      total: 29900, carrier: 'Казпочта', track: 'RR123KZ', trackUrl: 'https://qazpost.kz/t/RR123KZ', orderedAt: new Date('2026-11-10T08:00:00Z'), shippedAt: null }]);
    expect(b).toMatch(/№148/);
    expect(b).toMatch(/отправлен/);
    expect(b).toMatch(/RR123KZ/);
    expect(shopOrdersBlock([])).toBe('');
  });
  it('вопросы о заказе узнаются, обычные — нет', () => {
    ['Где мой заказ?', 'когда отправите посылку', 'трек номер скиньте', 'тапсырысым қайда?'].forEach((q) => expect(ORDER_STATUS_Q.test(q)).toBe(true));
    ['Есть 41 размер?', 'Сколько стоят кеды', 'Здравствуйте'].forEach((q) => expect(ORDER_STATUS_Q.test(q)).toBe(false));
  });
});

/* ── Привязка и сделка: база в памяти ── */
function fakeDb(stages?: Record<string, unknown>[]) {
  const t: Record<string, Record<string, unknown>[]> = {
    shopOrder: [], customer: [{ id: 'c1', waId: '77011234567', name: null, lastContactAt: new Date() }],
    conversation: [{ id: 'v1', customerId: 'c1', lastMessageAt: new Date() }],
    deal: [], dealEvent: [],
    pipelineStage: stages ?? [
      { id: 's-new', name: 'Новый', kind: 'NEW', position: 0 }, { id: 's-work', name: 'В работе', kind: 'WORK', position: 1 },
      { id: 's-order', name: 'Заказ', kind: 'ORDER', position: 2 }, { id: 's-won', name: 'Выдан', kind: 'WON', position: 3 },
      { id: 's-lost', name: 'Отказ', kind: 'LOST', position: 4 },
    ],
  };
  let n = 0;
  const match = (row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'stage') {
      const st = t.pipelineStage!.find((s) => s.id === row.stageId)!;
      const kind = (v as { kind: { notIn: string[] } }).kind;
      return !kind.notIn.includes(st.kind as string);
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const c = v as Record<string, unknown>;
      if ('endsWith' in c) return String(row[k]).endsWith(String(c.endsWith));
      if ('not' in c) return row[k] !== c.not;
      if ('notIn' in c) return !(c.notIn as unknown[]).includes(row[k]);
    }
    return v === null ? row[k] == null : row[k] === v;
  });
  const model = (name: string) => ({
    findFirst: async (a: { where?: Record<string, unknown>; include?: { stage?: boolean } } = {}) => {
      const r = t[name]!.filter((x) => match(x, a.where)).at(-1);
      if (!r) return null;
      return a.include?.stage ? { ...r, stage: t.pipelineStage!.find((s) => s.id === r.stageId) } : { ...r };
    },
    findMany: async () => t[name]!.map((x) => ({ ...x })),
    create: async (a: { data: Record<string, unknown> }) => { const r = { id: `${name}-${++n}`, archivedAt: null, amount: null, product: null, orderedAt: null, wonAt: null, lostAt: null, stageChangedAt: new Date(), ...a.data }; t[name]!.push(r); return r; },
    createMany: async () => ({ count: 0 }),
    updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { t[name]!.filter((x) => match(x, a.where)).forEach((x) => Object.assign(x, a.data)); return { count: 1 }; },
  });
  const db = Object.fromEntries(Object.keys(t).map((k) => [k, model(k)]));
  return { db: db as never, t };
}

const order = (o: Partial<ShopOrderInput> = {}): ShopOrderInput => ({
  id: 'o1', number: '148', phone: '+7 701 123 45 67', clientName: 'Айгерим', status: 'paid',
  items: [{ name: 'Кеды 99 хаки', size: '41', qty: 1, sum: 29900 }], total: 29900, source: 'WhatsApp', sellerName: 'Дана',
  city: null, carrier: null, track: null, trackUrl: null, orderedAt: new Date(), shippedAt: null, ...o,
});

describe('заказы из склада: привязка к клиенту и сделке', () => {
  it('оплаченный заказ создаёт сделку на этапе «Заказ» с суммой и товаром', async () => {
    const { db, t } = fakeDb();
    const r = await applyShopOrder(db, order());
    expect(r.linked).toBe(true);
    const deal = t.deal![0]!;
    expect(deal.stageId).toBe('s-order');
    expect(deal.amount).toBe(29900);
    expect(String(deal.product)).toMatch(/Кеды 99 хаки, р. 41/);
    expect(t.customer![0]!.name).toBe('Айгерим');
    expect(t.shopOrder![0]!.dealId).toBe(deal.id);
  });
  it('выкуп двигает в «Выдан», повтор того же статуса ничего не делает', async () => {
    const { db, t } = fakeDb();
    await applyShopOrder(db, order());
    await applyShopOrder(db, order({ status: 'completed' }));
    expect(t.deal![0]!.stageId).toBe('s-won');
    const events = t.dealEvent!.length;
    await applyShopOrder(db, order({ status: 'completed' }));
    expect(t.dealEvent!.length).toBe(events);
  });
  it('возврат после выдачи — только запись в истории, сделка остаётся выданной', async () => {
    const { db, t } = fakeDb();
    await applyShopOrder(db, order());
    await applyShopOrder(db, order({ status: 'completed' }));
    await applyShopOrder(db, order({ status: 'returned' }));
    expect(t.deal![0]!.stageId).toBe('s-won');
    expect(t.dealEvent!.some((e) => /возврат/.test(String(e.text)))).toBe(true);
  });
  it('отмена до выдачи — «Отказ» с причиной', async () => {
    const { db, t } = fakeDb();
    await applyShopOrder(db, order());
    await applyShopOrder(db, order({ status: 'cancelled' }));
    expect(t.deal![0]!.stageId).toBe('s-lost');
    expect(String(t.deal![0]!.lostReason)).toMatch(/№148 отменён/);
  });
  it('номера нет среди клиентов WhatsApp — заказ сохраняется без привязки', async () => {
    const { db, t } = fakeDb();
    const r = await applyShopOrder(db, order({ phone: '+7 777 000 00 00' }));
    expect(r.linked).toBe(false);
    expect(t.shopOrder!.length).toBe(1);
    expect(t.deal!.length).toBe(0);
  });
});

describe('ссылка на трек', () => {
  it('принимаем только http(s)', () => {
    const base = { id: 'x1', phone: '+7 701 111 22 33', status: 'shipped', items: [] };
    expect((parseShopOrder({ ...base, trackUrl: 'javascript:alert(1)' }) as { trackUrl: string | null }).trackUrl).toBeNull();
    expect((parseShopOrder({ ...base, trackUrl: 'https://qazpost.kz/t/AB1' }) as { trackUrl: string | null }).trackUrl).toBe('https://qazpost.kz/t/AB1');
  });
});

/* Воронка как у SHOQAI: своих этапов много, типа «Заказ» может не быть. */
const SHOQAI = [
  ['s1', 'Новый', 'NEW'], ['s2', 'Уточнял график работы', 'WORK'], ['s3', 'У менеджера', 'WORK'], ['s4', 'отправлен каталог', 'WORK'],
  ['s5', 'Думает', 'WORK'], ['s6', 'Ждем оплату', 'WORK'], ['s7', 'Продажа', 'WORK'], ['s8', 'Выкупил', 'WON'],
  ['s9', 'Придет в магазин', 'WORK'], ['s10', 'Нету ответа отказ', 'LOST'],
].map(([id, name, kind], position) => ({ id, name, kind, position }));

describe('этапы под свою воронку', () => {
  it('угадывает этапы по названиям', () => {
    const m = guessStageMap(SHOQAI as never);
    expect(m.draft).toBe('s6');
    expect(m.paid).toBe('s7');
    expect(m.shipped).toBe('s7'); // не «отправлен каталог»
    expect(m.completed).toBe('s8');
    expect(m.cancelled).toBe('s10');
  });
  it('сохранённое важнее догадки, «none» — не менять, удалённый этап — догадка', () => {
    const m = resolveStageMap(SHOQAI as never, { paid: 's9', draft: 'none', completed: 'deleted' });
    expect(m.paid).toBe('s9');
    expect(m.draft).toBeNull();
    expect(m.completed).toBe('s8');
  });
  it('без этапа типа «Заказ» сделка всё равно идёт: ждём оплату → продажа → выкупил', async () => {
    const { db, t } = fakeDb(SHOQAI);
    t.deal!.push({ id: 'd1', customerId: 'c1', stageId: 's5', archivedAt: null, amount: null, product: null, stageChangedAt: new Date() });
    await applyShopOrder(db, order({ status: 'draft' }));
    expect(t.deal![0]!.stageId).toBe('s6');
    await applyShopOrder(db, order({ status: 'paid' }));
    expect(t.deal![0]!.stageId).toBe('s7');
    await applyShopOrder(db, order({ status: 'completed' }));
    expect(t.deal![0]!.stageId).toBe('s8');
  });
  it('повтор без изменений догоняет сделку, но историю не засоряет', async () => {
    const { db, t } = fakeDb(SHOQAI);
    t.deal!.push({ id: 'd1', customerId: 'c1', stageId: 's5', archivedAt: null, amount: null, product: null, stageChangedAt: new Date() });
    await applyShopOrder(db, order({ status: 'paid' }), { paid: 'none' });
    expect(t.deal![0]!.stageId).toBe('s5');
    const notes = () => t.dealEvent!.filter((e) => e.type === 'note').length;
    const before = notes();
    await applyShopOrder(db, order({ status: 'paid' }));
    expect(t.deal![0]!.stageId).toBe('s7');
    expect(notes()).toBe(before);
  });
  it('отправленный заказ со сделкой на «Новый» — сразу в «Продажа»', async () => {
    const { db, t } = fakeDb(SHOQAI);
    t.deal!.push({ id: 'd1', customerId: 'c1', stageId: 's1', archivedAt: null, amount: null, product: null, stageChangedAt: new Date() });
    await applyShopOrder(db, order({ status: 'shipped' }));
    expect(t.deal![0]!.stageId).toBe('s7');
  });
  it('назад не двигает', async () => {
    const { db, t } = fakeDb(SHOQAI);
    t.deal!.push({ id: 'd1', customerId: 'c1', stageId: 's7', archivedAt: null, amount: null, product: null, stageChangedAt: new Date() });
    await applyShopOrder(db, order({ status: 'draft' }));
    expect(t.deal![0]!.stageId).toBe('s7');
  });
});

import { ensureOpenDeal, SILENT_REASON } from './crm.js';
describe('клиент «не отвечал», но снова написал', () => {
  it('сделка возвращается на свой этап', async () => {
    const { db, t } = fakeDb(SHOQAI);
    t.deal!.push({ id: 'd1', customerId: 'c1', stageId: 's10', archivedAt: null, amount: null, product: null, wonAt: null, lostAt: new Date(), lostReason: SILENT_REASON, stageChangedAt: new Date() });
    t.dealEvent!.push({ id: 'e1', dealId: 'd1', type: 'lost', data: { from: 's5', to: 's10' } });
    const d = await ensureOpenDeal(db, { customerId: 'c1', conversationId: 'v1' });
    expect(d?.id).toBe('d1');
    expect(t.deal![0]!.stageId).toBe('s5');
    expect(t.deal![0]!.lostReason).toBeNull();
  });
  it('сам отказался — остаётся в отказе (пишет вдогонку)', async () => {
    const { db, t } = fakeDb(SHOQAI);
    t.deal!.push({ id: 'd1', customerId: 'c1', stageId: 's10', archivedAt: null, amount: null, product: null, wonAt: null, lostAt: new Date(), lostReason: 'дорого', stageChangedAt: new Date() });
    expect(await ensureOpenDeal(db, { customerId: 'c1', conversationId: 'v1' })).toBeNull();
    expect(t.deal![0]!.stageId).toBe('s10');
  });
});

describe('свои этапы «Собран» и «Отправлен»', () => {
  it('угадываются, «отправлен каталог» — нет', () => {
    const st = ['Новый:NEW', 'отправлен каталог:WORK', 'Ждем оплату:WORK', 'Собран:WORK', 'Отправлен:WORK', 'Продажа:WORK', 'Выкупил:WON', 'Нету ответа отказ:LOST']
      .map((x, position) => { const [name, kind] = x.split(':'); return { id: `s${position}`, name: name!, kind: kind!, position }; });
    const m = guessStageMap(st);
    expect(m.assembled).toBe('s3');
    expect(m.shipped).toBe('s4');
    expect(m.paid).toBe('s5');
  });
});
