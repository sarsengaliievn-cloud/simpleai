const AVATAR_COLORS = ['#0B6E4F', '#1B4B7A', '#B4690E', '#6B3FA0', '#B42318', '#0E7490'];

export function initials(name: string | null, fallback: string) {
  const source = name?.trim() || fallback;
  return source
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function avatarColor(seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export function timeAgo(date: Date) {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'вчера' : `${d} дн`;
}

export function clock(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Almaty',
  }).format(date);
}

/** Время, а для не сегодняшней даты — ещё и день: «завтра в 14:20» без даты путает. */
export function clockWithDay(date: Date) {
  const tz = 'Asia/Almaty';
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  if (day(date) === day(new Date())) return clock(date);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(date);
}

/** Сумма в тенге с пробелами: 12 500 ₸. Дублирует core — тот в браузер не тянем. */
export function money(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return '—';
  return `${new Intl.NumberFormat('ru-RU').format(amount).replace(/[\u00a0\u202f]/g, ' ')} ₸`;
}

/** «3 дн на этапе», «5 ч на этапе». */
export function since(date: Date) {
  const t = timeAgo(date);
  return t === 'только что' ? 'только что' : t === 'вчера' ? 'с вчера' : t;
}

/** «5 мин назад», «только что», «вчера» — без «только что назад». */
export function agoText(date: Date) {
  const t = timeAgo(date);
  return t === 'только что' || t === 'вчера' ? t : `${t} назад`;
}

/** Тиыны → «1 234 ₸» / «0,94 ₸». Дублирует core для браузера. */
export function tiyn(value: number) {
  const kzt = value / 100;
  const abs = Math.abs(kzt);
  const text = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: abs < 100 && abs % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: abs < 100 ? 2 : 0,
  }).format(kzt).replace(/[  ]/g, ' ');
  return `${text} ₸`;
}
