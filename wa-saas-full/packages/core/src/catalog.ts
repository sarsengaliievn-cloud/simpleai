import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Каталог товаров компании: модели, цены, размеры и наличие по магазинам.
 * Берётся по ссылке (витрина склада отдаёт его JSON-ом) и кэшируется на
 * несколько минут — остатки меняются, но не каждую секунду.
 *
 * Формат — как у витрины склада SHOQAI (publicCatalog): точные количества
 * наружу не отдаются, только «есть / последняя пара».
 */

export type CatalogStore = { id: string; name: string; city: string; address: string; warehouse: boolean };
export type CatalogItem = {
  id: string;
  article: string;
  name: string;
  brand: string;
  category: string;
  season: string;
  color: string;
  gender: string;
  price: number;
  oldPrice: number | null;
  sizes: Array<{ size: string; inStock: boolean }>;
  /** storeId → [[размер, 1 — последняя пара], …] */
  avail: Record<string, Array<[string, number]>>;
};
export type Catalog = { stores: CatalogStore[]; items: CatalogItem[]; loadedAt: number };

export type CatalogSource = {
  url: string;
  /** Ссылка на модель для клиента, {id} заменяется на id модели. */
  productUrl?: string | null;
  /** Ссылка на фото модели, {id} — id модели. */
  photoUrl?: string | null;
};

export class CatalogError extends Error {}

const TTL_MS = 5 * 60 * 1000;
const MAX_BYTES = 20 * 1024 * 1024;
const cache = new Map<string, { at: number; catalog: Catalog }>();

const GENDER_LABEL: Record<string, string> = { m: 'мужская', w: 'женская', kids: 'детская', uni: 'унисекс' };

/** Адрес только https и не во внутреннюю сеть сервера: ссылку вводит клиент платформы. */
export async function assertPublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CatalogError('Ссылка на каталог не похожа на адрес сайта');
  }
  const allowPrivate = process.env.CATALOG_ALLOW_PRIVATE === '1';
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    throw new CatalogError('Ссылка на каталог должна начинаться с https://');
  }
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new CatalogError('Этот адрес недоступен');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new CatalogError('Сайт каталога не найден — проверьте ссылку');
  for (const a of addresses) if (isPrivateIp(a.address)) throw new CatalogError('Этот адрес недоступен');
  return url;
}

function isPrivateIp(ip: string) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Загрузить каталог по ссылке (с кэшем на 5 минут). */
export async function loadCatalog(source: CatalogSource, opts: { fresh?: boolean } = {}): Promise<Catalog> {
  const hit = cache.get(source.url);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.catalog;

  await assertPublicUrl(source.url);
  let res: Response;
  try {
    res = await fetch(source.url, { signal: AbortSignal.timeout(25_000), headers: { accept: 'application/json' }, redirect: 'error' });
  } catch (error) {
    // Склад недоступен — лучше вчерашние остатки, чем никаких: отдаём старый кэш до часа.
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.catalog;
    throw new CatalogError(`Каталог не ответил: ${(error as Error).message.slice(0, 120)}`);
  }
  if (!res.ok) {
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.catalog;
    throw new CatalogError(`Каталог ответил ошибкой ${res.status}`);
  }
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new CatalogError('Каталог слишком большой');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new CatalogError('Каталог слишком большой');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CatalogError('По ссылке не JSON — нужна ссылка на выгрузку каталога, а не на страницу магазина');
  }
  const catalog = normalizeCatalog(raw);
  if (catalog.items.length === 0) throw new CatalogError('В каталоге нет ни одной модели');
  cache.set(source.url, { at: Date.now(), catalog });
  return catalog;
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');

/** Приводим чужой JSON к нашему виду и отбрасываем всё лишнее. */
export function normalizeCatalog(raw: unknown): Catalog {
  const data = (raw ?? {}) as { stores?: unknown[]; items?: unknown[] };
  const stores = (Array.isArray(data.stores) ? data.stores : []).slice(0, 200).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return { id: str(o.id, 80), name: str(o.name, 120), city: str(o.city, 80), address: str(o.address, 200), warehouse: !!o.warehouse };
  }).filter((s) => s.id);
  const items = (Array.isArray(data.items) ? data.items : []).slice(0, 20000).map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const sizes = (Array.isArray(o.sizes) ? o.sizes : []).map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      return { size: normSize(str(x.size, 12)), inStock: !!x.inStock };
    }).filter((s) => s.size);
    const avail: Record<string, Array<[string, number]>> = {};
    if (o.avail && typeof o.avail === 'object') {
      for (const [storeId, list] of Object.entries(o.avail as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        avail[storeId.slice(0, 80)] = list
          .filter((p) => Array.isArray(p) && p.length >= 1)
          .map((p) => [normSize(str((p as unknown[])[0], 12)), Number((p as unknown[])[1]) === 1 ? 1 : 0] as [string, number]);
      }
    }
    const price = Math.round(Number(o.price) || 0);
    const oldPrice = Math.round(Number(o.oldPrice) || 0);
    return {
      id: str(o.id, 128), article: str(o.article, 60), name: str(o.name, 200), brand: str(o.brand, 80),
      category: str(o.category, 80), season: str(o.season, 60), color: str(o.color, 60), gender: str(o.gender, 10),
      price, oldPrice: oldPrice > price ? oldPrice : null, sizes, avail,
    };
  }).filter((i) => i.id && i.name);
  return { stores, items, loadedAt: Date.now() };
}

/** «42-й», «42,5» → «42», «42.5». */
export function normSize(raw: string) {
  const m = String(raw ?? '').replace(',', '.').match(/\d{1,2}(?:\.5)?/);
  return m ? m[0] : String(raw ?? '').trim();
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Сезон из слов клиента: «зимние», «қысқы», «демисезон» → основа для сравнения. */
const SEASONS: Array<[RegExp, RegExp]> = [
  [/зим|қыс|кыс|winter/i, /зим|winter/i],
  [/осен|деми|күз|куз|весн|көктем|коктем|autumn|spring/i, /осен|деми|весн|autumn|spring/i],
  [/лет|жаз|summer/i, /лет|summer/i],
];

export type CatalogQuery = {
  article?: string | null;
  model?: string | null;
  size?: string | null;
  gender?: string | null;
  season?: string | null;
  color?: string | null;
  maxPrice?: number | null;
  /** Весь текст диалога — ищем в нём артикулы и ссылки на модели. */
  context?: string;
};

export type CatalogMatch = { mode: 'product' | 'pick' | 'none'; items: CatalogItem[]; size: string | null };

/** Найти модель, о которой говорит клиент, или подобрать подходящие. */
export function searchCatalog(catalog: Catalog, q: CatalogQuery, productUrl?: string | null): CatalogMatch {
  const size = q.size ? normSize(q.size) : null;
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const byArticle = new Map<string, CatalogItem[]>();
  for (const i of catalog.items) {
    const k = compact(i.article);
    if (k.length >= 3) byArticle.set(k, [...(byArticle.get(k) ?? []), i]);
  }

  // 1. Артикул, который назвал клиент.
  if (q.article) {
    const found = byArticle.get(compact(q.article));
    if (found?.length) return { mode: 'product', items: found.slice(0, 3), size };
  }

  // 2. Ссылка на модель или артикул в переписке (последнее упоминание важнее).
  const ctx = q.context ?? '';
  if (ctx) {
    const ids = [...ctx.matchAll(/#p=([A-Za-z0-9_-]{4,128})/g)].map((m) => m[1]!);
    for (const id of ids.reverse()) {
      const item = byId.get(id);
      if (item) return { mode: 'product', items: [item], size };
    }
    if (productUrl && productUrl.includes('{id}')) {
      const [before, after = ''] = productUrl.split('{id}');
      const re = new RegExp(`${escapeRe(before!)}([A-Za-z0-9_-]{4,128})${escapeRe(after)}`, 'g');
      for (const m of [...ctx.matchAll(re)].reverse()) {
        const item = byId.get(m[1]!);
        if (item) return { mode: 'product', items: [item], size };
      }
    }
  }

  // 3. Название модели словами клиента.
  if (q.model && q.model.trim().length >= 3) {
    const words = norm(q.model).split(' ').filter((w) => w.length >= 2);
    if (words.length) {
      const scored = catalog.items
        .map((i) => {
          const hay = ` ${norm(`${i.name} ${i.brand} ${i.color} ${i.article}`)} `;
          const hit = words.filter((w) => hay.includes(` ${w}`) || hay.includes(w)).length;
          return { i, score: hit / words.length };
        })
        .filter((x) => x.score >= 0.6)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        const best = scored[0]!.score;
        return { mode: 'product', items: scored.filter((x) => x.score === best).slice(0, 3).map((x) => x.i), size };
      }
    }
  }

  // 4. Подбор по признакам: пол, сезон, размер, цвет, бюджет.
  const hasFilter = q.gender || q.season || q.color || q.maxPrice || size;
  if (!hasFilter) return { mode: 'none', items: [], size };

  const season = q.season ? SEASONS.find(([client]) => client.test(q.season!))?.[1] ?? null : null;
  const color = q.color ? norm(q.color).slice(0, 4) : '';
  const gender = q.gender && GENDER_LABEL[q.gender] ? q.gender : null;
  const picked = catalog.items.filter((i) => {
    if (gender && i.gender && i.gender !== gender && i.gender !== 'uni') return false;
    if (season && !season.test(i.season)) return false;
    if (color && !norm(i.color).includes(color)) return false;
    if (q.maxPrice && i.price > q.maxPrice) return false;
    if (size && !i.sizes.some((s) => s.size === size && s.inStock)) return false;
    return i.sizes.some((s) => s.inStock);
  });
  // Сначала то, что есть в большем числе магазинов, затем со скидкой.
  const spread = (i: CatalogItem) => (size ? Object.values(i.avail).filter((l) => l.some(([s]) => s === size)).length : Object.keys(i.avail).length);
  picked.sort((a, b) => spread(b) - spread(a) || Number(!!b.oldPrice) - Number(!!a.oldPrice) || a.price - b.price);
  return { mode: picked.length ? 'pick' : 'none', items: picked.slice(0, 5), size };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const money = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n).replace(/[  ]/g, ' ')} ₸`;

export function productLink(source: Pick<CatalogSource, 'productUrl'>, id: string) {
  return source.productUrl && source.productUrl.includes('{id}') ? source.productUrl.replace('{id}', encodeURIComponent(id)) : '';
}
export function photoLink(source: Pick<CatalogSource, 'photoUrl'>, id: string) {
  return source.photoUrl && source.photoUrl.includes('{id}') ? source.photoUrl.replace('{id}', encodeURIComponent(id)) : '';
}

const storeLabel = (s: CatalogStore) => [s.city, s.address || s.name].filter(Boolean).join(', ') || s.name;

/** Где есть размер: «Алматы, Розыбакиева 12 (последняя пара)». */
export function sizeAvailability(catalog: Catalog, item: CatalogItem, size: string) {
  const here: string[] = [];
  const order: string[] = [];
  for (const store of catalog.stores) {
    const entry = (item.avail[store.id] ?? []).find(([s]) => s === size);
    if (!entry) continue;
    if (store.warehouse) order.push(storeLabel(store));
    else here.push(`${storeLabel(store)}${entry[1] === 1 ? ' (последняя пара)' : ''}`);
  }
  return { here, order };
}

/** Строка модели для ассистента и менеджера. */
export function describeItem(catalog: Catalog, item: CatalogItem, size: string | null, source: CatalogSource) {
  const lines: string[] = [];
  const attrs = [item.brand, GENDER_LABEL[item.gender] ?? '', item.season, item.color].filter(Boolean).join(', ');
  lines.push(`Модель: ${item.name}${item.article ? ` (арт. ${item.article})` : ''}${attrs ? ` — ${attrs}` : ''}.`);
  lines.push(`Цена: ${money(item.price)}${item.oldPrice ? ` (без скидки ${money(item.oldPrice)})` : ''}.`);
  const inStock = item.sizes.filter((s) => s.inStock).map((s) => s.size);
  lines.push(inStock.length ? `Размеры в наличии: ${inStock.join(', ')}.` : 'Сейчас нет ни одного размера.');
  if (size) {
    const { here, order } = sizeAvailability(catalog, item, size);
    if (here.length) lines.push(`Размер ${size} есть: ${here.join('; ')}.`);
    if (order.length) lines.push(`Размер ${size} ${here.length ? 'также ' : ''}есть на складе — привезут в магазин под заказ.`);
    if (!here.length && !order.length) lines.push(`Размера ${size} сейчас нет ни в одном магазине.`);
    const cities = [...new Set(catalog.stores.filter((s) => !s.warehouse && s.city).map((s) => s.city))];
    const missing = cities.filter((c) => !here.some((h) => h.startsWith(c)));
    if (here.length && missing.length) lines.push(`В городе ${missing.join(', ')} размера ${size} нет.`);
  }
  const link = productLink(source, item.id);
  if (link) lines.push(`Ссылка на модель: ${link}`);
  return lines.join('\n');
}

/** Блок «КАТАЛОГ» для ассистента: только факты, наличие и цены — отсюда. */
export function catalogBlock(catalog: Catalog, match: CatalogMatch, source: CatalogSource) {
  if (match.mode === 'none' || match.items.length === 0) return '';
  const head =
    match.mode === 'product'
      ? match.items.length > 1
        ? 'КАТАЛОГ: под описание клиента подходят несколько моделей — уточни, какую он имеет в виду.'
        : 'КАТАЛОГ: модель, о которой спрашивает клиент (данные склада на сейчас).'
      : `КАТАЛОГ: модели в наличии под запрос клиента${match.size ? ` (размер ${match.size})` : ''} — предложи 2–3 из них со ссылками.`;
  return [head, ...match.items.map((i, n) => `${n + 1}) ${describeItem(catalog, i, match.size, source)}`)].join('\n\n');
}

/** Список магазинов — чтобы ассистент не путал города и адреса. */
export function storesLine(catalog: Catalog) {
  const shops = catalog.stores.filter((s) => !s.warehouse);
  return shops.length ? `Магазины: ${shops.map(storeLabel).join('; ')}.` : '';
}

/** Для тестов: сбросить кэш. */
export function clearCatalogCache() {
  cache.clear();
}
