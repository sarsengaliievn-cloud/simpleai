/**
 * Поведение ассистента «как живой менеджер»: ответ частями, рабочие часы.
 * Чистые функции без базы и сети — их легко проверять тестами.
 */

// ─────────────────────────────────────────────
// Разбивка длинного ответа
// ─────────────────────────────────────────────

/** Больше частей подряд выглядит как спам — хвост склеивается в последнюю. */
const MAX_PARTS = 4;

/**
 * Длинный ответ режется на несколько сообщений, как пишут люди в мессенджере.
 *
 * Абзацы (разделены пустой строкой) — всегда отдельные сообщения: модель
 * сама ставит пустую строку там, где мысль заканчивается. Абзац длиннее
 * лимита режется по предложениям, а не посередине слова.
 */
export function splitReply(text: string, maxChars = 350, maxParts = MAX_PARTS): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const limit = Math.max(80, maxChars);
  const paragraphs = clean.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);

  // Короткий ответ одним абзацем не трогаем вовсе.
  if (paragraphs.length === 1 && clean.length <= limit) return [clean];

  const parts: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= limit) {
      parts.push(paragraph);
      continue;
    }
    let current = '';
    for (const sentence of sentences(paragraph)) {
      for (const piece of hardSplit(sentence, limit)) {
        if (current && (current + piece).length > limit) {
          parts.push(current.trim());
          current = '';
        }
        current += piece;
      }
    }
    if (current.trim()) parts.push(current.trim());
  }

  if (parts.length <= maxParts) return parts;
  return [...parts.slice(0, maxParts - 1), parts.slice(maxParts - 1).join('\n\n')];
}

/** Режем только по пробелу после знака конца предложения — ни один символ не теряется. */
function sentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?…][)»"']?)(\s+)/);
  const out: string[] = [];
  // split с группой чередует [предложение, пробел, предложение, …] —
  // пробел (или перенос строки) остаётся при своём предложении.
  for (let i = 0; i < raw.length; i += 2) out.push(raw[i]! + (raw[i + 1] ?? ''));
  return out.filter((s) => s.trim());
}

/** Предложение без точек длиннее лимита — режем по пробелу, а не посреди слова. */
function hardSplit(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut) + ' ');
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Пауза перед следующей частью: мгновенная очередь из трёх сообщений
 * выдаёт бота. ~1 секунда плюс «набор» текста, но не дольше 4 секунд.
 */
export function typingDelayMs(text: string): number {
  return Math.min(4000, 900 + text.length * 15);
}

// ─────────────────────────────────────────────
// Рабочие часы
// ─────────────────────────────────────────────

export type WorkingHours = {
  /** Дни недели: 1 — понедельник … 7 — воскресенье. */
  days: number[];
  /** "HH:MM" по часовому поясу компании. */
  start: string;
  end: string;
};

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** День недели и минуты от полуночи в заданном часовом поясе. */
export function localClock(now: Date, timeZone: string): { day: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    // Кривой часовой пояс в настройках не должен ронять ответ клиенту.
    return localClock(now, 'Asia/Almaty');
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: WEEKDAY[get('weekday')] ?? 1,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Работает ли ассистент сейчас.
 *
 * Если начало позже конца (22:00–08:00), это ночная смена: она принадлежит
 * дню, в который началась. Пятница 22:00–08:00 захватывает утро субботы,
 * даже если суббота в списке дней не отмечена.
 *
 * Начало, равное концу, — круглые сутки в отмеченные дни.
 */
export function isWithinWorkingHours(now: Date, timeZone: string, hours: WorkingHours): boolean {
  if (!TIME_RE.test(hours.start) || !TIME_RE.test(hours.end) || hours.days.length === 0) return true;

  const { day, minutes } = localClock(now, timeZone);
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  const today = hours.days.includes(day);

  if (start === end) return today;
  if (start < end) return today && minutes >= start && minutes < end;

  const yesterday = hours.days.includes(day === 1 ? 7 : day - 1);
  return (today && minutes >= start) || (yesterday && minutes < end);
}
