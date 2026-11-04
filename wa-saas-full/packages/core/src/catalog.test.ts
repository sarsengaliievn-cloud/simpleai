import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeCatalog, searchCatalog, catalogBlock, describeItem, normSize, assertPublicUrl, shownProductIds } from './catalog.js';
import { parseUnderstanding } from './ai/understand.js';
import { draftOrder, orderQuestion, orderConfirmation } from './ai/rag.js';

const raw = JSON.parse(readFileSync(new URL('./__fixtures__/catalog.json', import.meta.url), 'utf8'));
const catalog = normalizeCatalog(raw);
const source = { url: 'https://example.kz/c', productUrl: 'https://sklad-obuv.web.app/shop/#p={id}', photoUrl: 'https://x.kz/photo?id={id}' };

describe('каталог склада', () => {
  it('читает витрину склада', () => {
    expect(catalog.items).toHaveLength(5);
    expect(catalog.stores.find((s) => s.id === 'w1')?.warehouse).toBe(true);
  });
  it('размер из слов клиента', () => {
    expect(normSize('42-й')).toBe('42');
    expect(normSize('37,5')).toBe('37.5');
  });
  it('находит модель по артикулу', () => {
    const m = searchCatalog(catalog, { article: 'z701', size: '42' });
    expect(m.mode).toBe('product');
    expect(m.items[0]!.id).toBe('P100');
  });
  it('находит модель по ссылке из переписки', () => {
    const m = searchCatalog(catalog, { size: '42', context: 'Менеджер: вот модель https://sklad-obuv.web.app/shop/#p=P101 \nКлиент: а 38 есть?' }, source.productUrl);
    expect(m.items[0]!.id).toBe('P101');
  });
  it('находит модель по названию', () => {
    const m = searchCatalog(catalog, { model: 'ботинки Арктика' });
    expect(m.mode).toBe('product');
    expect(m.items[0]!.id).toBe('P100');
  });
  it('наличие размера по магазинам и городам', () => {
    const text = describeItem(catalog, catalog.items[0]!, '42', source);
    expect(text).toMatch(/Размер 42 есть: Алматы, Розыбакиева 247 \(последняя пара\); Алматы, Наурызбай батыра 28/);
    expect(text).toMatch(/В городе Астана размера 42 нет/);
    expect(text).toMatch(/#p=P100/);
    const none = describeItem(catalog, catalog.items[0]!, '43', source);
    expect(none).toMatch(/Размера 43 сейчас нет ни в одном магазине/);
    const order = describeItem(catalog, catalog.items[0]!, '41', source);
    expect(order).toMatch(/на складе — привезут в магазин под заказ/);
  });
  it('подбор: зимние женские 38 — только подходящие и в наличии', () => {
    const m = searchCatalog(catalog, { gender: 'w', season: 'қысқы', size: '38' });
    expect(m.mode).toBe('pick');
    expect(m.items.map((i) => i.id).sort()).toEqual(['P101', 'P102']);
    expect(catalogBlock(catalog, m, source)).toMatch(/предложи 2–3/);
  });
  it('подбор с бюджетом', () => {
    const m = searchCatalog(catalog, { gender: 'w', season: 'зима', maxPrice: 30000 });
    expect(m.items.map((i) => i.id)).toEqual(['P102']);
  });
  it('ничего не подходит — пусто', () => {
    expect(searchCatalog(catalog, { gender: 'm', season: 'лето' }).mode).toBe('none');
  });
  it('в чужую сеть сервер не ходит', async () => {
    await expect(assertPublicUrl('http://example.com/x')).rejects.toThrow(/https/);
    await expect(assertPublicUrl('https://127.0.0.1/x')).rejects.toThrow(/недоступен/);
    await expect(assertPublicUrl('https://localhost/x')).rejects.toThrow(/недоступен/);
    await expect(assertPublicUrl('https://10.0.0.5/x')).rejects.toThrow(/недоступен/);
  });
});

describe('разбор сообщения', () => {
  it('читает JSON модели, лишнее отбрасывает', () => {
    const u = parseUnderstanding('```json\n{"query":"Есть ли 41 размер?","intent":"stock","lang":"kk","size":"41","gender":"x","max_price":"30 000"}\n```', 'исходный');
    expect(u).toMatchObject({ query: 'Есть ли 41 размер?', intent: 'stock', lang: 'kk', size: '41', gender: '' });
  });
  it('мусор — null', () => {
    expect(parseUnderstanding('не знаю', 'q')).toBeNull();
  });
});

describe('готов купить', () => {
  const base = { query: '', intent: 'buy' as const, lang: 'ru' as const, article: '', model: '', size: '', gender: '', season: '', color: '', maxPrice: null, city: '', delivery: '', payment: '' };
  it('не хватает модели, размера и города — спросить разом', () => {
    const o = draftOrder(base, catalog, null, source);
    expect(o.missing).toEqual(['model', 'size', 'city']);
    expect(orderQuestion(o)).toBe('Хорошо! Подскажите, пожалуйста, какую модель берёте (артикул или ссылку из каталога), какой размер и в какой город доставить или заберёте в магазине?');
    expect(orderQuestion({ missing: ['size'], lang: 'kk' })).toBe('Жақсы! Нақтылап жіберіңізші: қай размер?');
  });
  it('всё есть — сводка с наличием для менеджера', () => {
    const u = { ...base, article: 'Z-701', size: '42', city: 'Астана', delivery: 'Казпочта', payment: 'Kaspi' };
    const m = searchCatalog(catalog, { article: u.article, size: u.size });
    const o = draftOrder(u, catalog, m, source);
    expect(o.missing).toEqual([]);
    expect(o.product).toBe('Зимние ботинки Арктика (арт. Z-701), размер 42');
    expect(o.amount).toBe(33900);
    expect(o.comment).toBe('Астана · Казпочта · Kaspi');
    expect(o.summary).toMatch(/Наличие 42: Алматы, Розыбакиева 247 \(последняя пара\)/);
    expect(orderConfirmation('kk')).toMatch(/менеджерге/);
  });
  it('без склада размер не обязателен', () => {
    const o = draftOrder({ ...base, model: 'чёрная сумка', delivery: 'заберу в магазине' }, null, null, null);
    expect(o.missing).toEqual([]);
  });
});

describe('подбор не повторяется', () => {
  it('уже показанные модели уходят в конец, новые — вперёд', () => {
    const shown = new Set(['P101']);
    const m = searchCatalog(catalog, { gender: 'w', season: 'зима', exclude: shown });
    expect(m.items[0]!.id).toBe('P102');
    expect(m.unseen).toBe(1);
  });
  it('все показаны — блок просит предложить другое', () => {
    const m = searchCatalog(catalog, { gender: 'w', season: 'зима', exclude: new Set(['P101', 'P102']) });
    expect(m.unseen).toBe(0);
    expect(catalogBlock(catalog, m, source)).toMatch(/Новых моделей под этот запрос больше нет/);
  });
  it('разный порядок при разных запросах', () => {
    const orders = new Set<string>();
    let seed = 1;
    for (let k = 0; k < 20; k += 1) {
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      orders.add(searchCatalog(catalog, { season: 'зима', random: rnd }).items.map((i) => i.id).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
  it('ссылки, которые бот уже отправлял', () => {
    expect([...shownProductIds(['Вот: https://sklad-obuv.web.app/shop/#p=P100 и #p=P104'], source.productUrl)]).toEqual(['P100', 'P104']);
  });
  it('модель без размера — размеры по магазинам и просьба назвать размер', () => {
    const m = searchCatalog(catalog, { context: 'Мына модель бар ма?\nАртикул: Z-701\nНа сайте: https://sklad-obuv.web.app/shop/#p=P100' }, source.productUrl);
    const block = catalogBlock(catalog, m, source);
    expect(block).toMatch(/По магазинам: Алматы, Розыбакиева 247 — 40, 42; Алматы, Наурызбай батыра 28 — 41, 42; Алматы, Центральный склад \(склад, под заказ\) — 41/);
    expect(block).toMatch(/спроси, какой нужен/);
    expect(block).toMatch(/Не отправляй клиента искать самому/);
  });
});

describe('подбор после показанных моделей', () => {
  it('«покажите ещё» не цепляется за ссылку из прошлого ответа бота', () => {
    const m = searchCatalog(catalog, { gender: 'w', season: 'зима', pick: true, context: 'Бот: Зимние сапоги — https://sklad-obuv.web.app/shop/#p=P101', exclude: new Set(['P101']) }, source.productUrl);
    expect(m.mode).toBe('pick');
    expect(m.items[0]!.id).toBe('P102');
  });
});
