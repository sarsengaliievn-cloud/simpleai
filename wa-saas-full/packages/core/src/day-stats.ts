/**
 * Аналитика по дням: период в часовом поясе компании и таблица «день за днём».
 * Чистые функции — страница и выгрузка в Excel считают одинаково.
 */

const DAY = 24 * 60 * 60 * 1000;

/** «2026-11-18» в часовом поясе компании. */
export function dayKeyOf(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Насколько часы зоны впереди UTC в момент `at`, мс. */
function offsetMs(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Полночь дня `key` в зоне компании — как момент времени. */
export function startOfDayKey(key: string, timeZone: string) {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // Смещение берём на сам момент полуночи: в зонах с переводом часов оно разное.
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

export function addDays(key: string, n: number) {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;

export type Period = {
  /** Как пришло в адресе: today | yesterday | 7 | 30 | 90 | custom */
  id: string;
  fromKey: string;
  toKey: string;
  from: Date;
  /** Конец периода (не включая): полночь после последнего дня или «сейчас». */
  to: Date;
  /** Дни периода по порядку, от первого к последнему. */
  keys: string[];
  label: string;
};

/**
 * Период из адреса страницы. Дни — календарные в поясе компании: «Сегодня» —
 * с полуночи, «7 дней» — сегодня и шесть предыдущих. Произвольные даты —
 * `from`/`to` (включительно), не больше 366 дней.
 */
export function resolvePeriod(input: { d?: string; from?: string; to?: string }, timeZone: string, now = new Date()): Period {
  const today = dayKeyOf(now, timeZone);
  let id = input.d ?? '30';
  let fromKey: string;
  let toKey = today;
  if (input.from && KEY.test(input.from)) {
    id = 'custom';
    fromKey = input.from;
    toKey = input.to && KEY.test(input.to) ? input.to : input.from;
    if (toKey < fromKey) [fromKey, toKey] = [toKey, fromKey];
    if (toKey > today) toKey = today;
    if (fromKey > today) fromKey = today;
    if (startOfDayKey(toKey, timeZone).getTime() - startOfDayKey(fromKey, timeZone).getTime() > 365 * DAY) fromKey = addDays(toKey, -365);
  } else if (id === 'today') {
    fromKey = today;
  } else if (id === 'yesterday') {
    fromKey = toKey = addDays(today, -1);
  } else {
    const n = [7, 30, 90].includes(Number(id)) ? Number(id) : 30;
    id = String(n);
    fromKey = addDays(today, -(n - 1));
  }
  const keys: string[] = [];
  for (let k = fromKey; k <= toKey; k = addDays(k, 1)) keys.push(k);
  const end = startOfDayKey(addDays(toKey, 1), timeZone);
  const fmt = (k: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${k}T00:00:00Z`));
  const label = id === 'today' ? 'сегодня' : id === 'yesterday' ? 'вчера' : fromKey === toKey ? fmt(fromKey) : `${fmt(fromKey)} — ${fmt(toKey)}`;
  return {
    id, fromKey, toKey, keys, label,
    from: startOfDayKey(fromKey, timeZone),
    to: end.getTime() > now.getTime() ? now : end,
  };
}

export type DayLead = { createdAt: Date; ad: boolean; archived: boolean; answeredInMin: number | null };
export type DayOrder = { orderedAt: Date; total: number; status: string };

export type DayRow = {
  key: string;
  leads: number;
  fromAds: number;
  /** Лиды, которым ответили (бот или человек) не позже чем за `fastMin` минут. */
  answeredFast: number;
  /** Лиды, которым не ответили вовсе. */
  unanswered: number;
  orders: number;
  revenue: number;
  /** Из заказов этого дня — выкуплены (у склада) / выданы. */
  completed: number;
  /** Из заказов этого дня — отменены или вернулись. */
  cancelled: number;
  lost: number;
  /** заказы ÷ лиды, %, одна цифра после запятой; null — лидов не было. */
  conversion: number | null;
  averageCheck: number | null;
};

const CANCELLED = new Set(['cancelled', 'returned']);

/**
 * Таблица по дням. Заказ считается в день оформления; выкуп и отмену видно в
 * строке того же дня — «из заказов 12-го выкупили 5». Так строку не надо
 * пересчитывать задним числом, и видно, какой день продавал лучше.
 */
export function dayTable(
  keys: string[],
  timeZone: string,
  data: { leads: DayLead[]; orders: DayOrder[]; lostAt: Date[]; fastMin?: number },
): { rows: DayRow[]; total: DayRow } {
  const fast = data.fastMin ?? 15;
  const empty = (key: string): DayRow => ({
    key, leads: 0, fromAds: 0, answeredFast: 0, unanswered: 0, orders: 0, revenue: 0, completed: 0, cancelled: 0, lost: 0, conversion: null, averageCheck: null,
  });
  const byKey = new Map(keys.map((k) => [k, empty(k)]));
  const row = (at: Date) => byKey.get(dayKeyOf(at, timeZone));

  for (const l of data.leads) {
    const r = row(l.createdAt);
    if (!r || l.archived) continue;
    r.leads += 1;
    if (l.ad) r.fromAds += 1;
    if (l.answeredInMin === null) r.unanswered += 1;
    else if (l.answeredInMin <= fast) r.answeredFast += 1;
  }
  for (const o of data.orders) {
    const r = row(o.orderedAt);
    if (!r) continue;
    if (o.status === 'cancelled') { r.cancelled += 1; continue; }
    r.orders += 1;
    r.revenue += o.total;
    if (o.status === 'completed') r.completed += 1;
    if (CANCELLED.has(o.status)) r.cancelled += 1;
  }
  for (const at of data.lostAt) {
    const r = row(at);
    if (r) r.lost += 1;
  }

  const finish = (r: DayRow) => {
    r.conversion = r.leads ? Math.round((r.orders / r.leads) * 1000) / 10 : null;
    r.averageCheck = r.orders ? Math.round(r.revenue / r.orders) : null;
    return r;
  };
  const rows = keys.map((k) => finish(byKey.get(k)!));
  const total = empty('total');
  for (const r of rows) {
    for (const f of ['leads', 'fromAds', 'answeredFast', 'unanswered', 'orders', 'revenue', 'completed', 'cancelled', 'lost'] as const) total[f] += r[f];
  }
  return { rows, total: finish(total) };
}

/**
 * Через сколько минут лиду впервые ответили: первое исходящее не раньше
 * создания сделки. `outbound` — по возрастанию времени, по разговорам.
 */
export function firstReplyMinutes(createdAt: Date, outbound: Date[] | undefined): number | null {
  if (!outbound) return null;
  const first = outbound.find((at) => at.getTime() >= createdAt.getTime() - 1000);
  return first ? Math.max(0, Math.round((first.getTime() - createdAt.getTime()) / 60000)) : null;
}
