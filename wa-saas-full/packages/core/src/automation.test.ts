import { describe, it, expect } from 'vitest';
import { parseMetaWebhook } from '@wa/whatsapp';
import { splitReply, typingDelayMs, isWithinWorkingHours, localClock } from './automation.js';
import { buildSystemPrompt } from './ai/prompt.js';

describe('ответ частями', () => {
  it('короткий ответ не режется', () => {
    expect(splitReply('Да, 42 есть в чёрном.')).toEqual(['Да, 42 есть в чёрном.']);
  });

  it('абзацы — отдельные сообщения, даже если весь ответ короткий', () => {
    expect(splitReply('Здравствуйте!\n\nДа, 42 есть. Цена 24 900 ₸.')).toEqual([
      'Здравствуйте!',
      'Да, 42 есть. Цена 24 900 ₸.',
    ]);
  });

  it('длинный абзац режется по предложениям, ни один символ не теряется', () => {
    const sentence = 'Доставка по Алматы на следующий день, по Казахстану — 2–4 дня. ';
    const text = sentence.repeat(12).trim();
    const parts = splitReply(text, 200);
    expect(parts.length).toBeGreaterThan(1);
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThanOrEqual(200);
    expect(parts.every((p) => p.endsWith('.'))).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('не больше 4 сообщений — хвост склеивается в последнее', () => {
    const parts = splitReply(['Раз.', 'Два.', 'Три.', 'Четыре.', 'Пять.', 'Шесть.'].join('\n\n'));
    expect(parts).toHaveLength(4);
    expect(parts[3]).toBe('Четыре.\n\nПять.\n\nШесть.');
  });

  it('текст без точек режется по пробелу, а не посреди слова', () => {
    const text = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ');
    const parts = splitReply(text, 150);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(' ')).toBe(text);
  });

  it('пустой ответ — пустой список', () => {
    expect(splitReply('  \n ')).toEqual([]);
  });

  it('пауза между частями растёт с длиной, но не больше 4 секунд', () => {
    expect(typingDelayMs('Ок')).toBeLessThan(typingDelayMs('Длинное сообщение '.repeat(5)));
    expect(typingDelayMs('x'.repeat(5000))).toBe(4000);
  });
});

describe('рабочие часы', () => {
  // 2026-10-27 — вторник. Алматы — UTC+5.
  const at = (isoUtc: string) => new Date(isoUtc);
  const TZ = 'Asia/Almaty';

  it('время и день недели считаются по часовому поясу компании', () => {
    expect(localClock(at('2026-10-27T04:30:00Z'), TZ)).toEqual({ day: 2, minutes: 9 * 60 + 30 });
    // 20:30 UTC понедельника — уже 01:30 вторника в Алматы.
    expect(localClock(at('2026-10-26T20:30:00Z'), TZ).day).toBe(2);
  });

  const weekdays = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };

  it('дневной график', () => {
    expect(isWithinWorkingHours(at('2026-10-27T04:00:00Z'), TZ, weekdays)).toBe(true); // вт 09:00
    expect(isWithinWorkingHours(at('2026-10-27T03:59:00Z'), TZ, weekdays)).toBe(false); // вт 08:59
    expect(isWithinWorkingHours(at('2026-10-27T13:00:00Z'), TZ, weekdays)).toBe(false); // вт 18:00
    expect(isWithinWorkingHours(at('2026-10-31T06:00:00Z'), TZ, weekdays)).toBe(false); // сб 11:00
  });

  it('ночная смена принадлежит дню, в который началась', () => {
    const night = { days: [5], start: '22:00', end: '08:00' }; // только с пятницы на субботу
    expect(isWithinWorkingHours(at('2026-10-30T17:30:00Z'), TZ, night)).toBe(true); // пт 22:30
    expect(isWithinWorkingHours(at('2026-10-31T02:00:00Z'), TZ, night)).toBe(true); // сб 07:00
    expect(isWithinWorkingHours(at('2026-10-31T03:00:00Z'), TZ, night)).toBe(false); // сб 08:00
    expect(isWithinWorkingHours(at('2026-10-31T17:30:00Z'), TZ, night)).toBe(false); // сб 22:30
  });

  it('начало равно концу — круглые сутки в отмеченные дни', () => {
    const allDay = { days: [2], start: '00:00', end: '00:00' };
    expect(isWithinWorkingHours(at('2026-10-27T18:00:00Z'), TZ, allDay)).toBe(true); // вт 23:00
    expect(isWithinWorkingHours(at('2026-10-27T19:30:00Z'), TZ, allDay)).toBe(false); // ср 00:30
  });

  it('кривые настройки не выключают ассистента навсегда', () => {
    expect(isWithinWorkingHours(new Date(), TZ, { days: [], start: '09:00', end: '18:00' })).toBe(true);
    expect(isWithinWorkingHours(new Date(), TZ, { days: [1], start: '9 утра', end: '18:00' })).toBe(true);
    expect(() => isWithinWorkingHours(new Date(), 'Нет/Такого', weekdays)).not.toThrow();
  });
});

describe('голосовые в вебхуке', () => {
  it('голосовое разбирается как audio с media id', () => {
    const [voice] = parseMetaWebhook({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '123' },
        messages: [{
          id: 'v1', from: '7701', type: 'audio', timestamp: '1700000000',
          audio: { id: '987654321', mime_type: 'audio/ogg; codecs=opus', voice: true },
        }],
      } }] }],
    });
    expect(voice).toMatchObject({ type: 'audio', mediaId: '987654321', mediaMimeType: 'audio/ogg; codecs=opus' });
    expect(voice?.text).toBeUndefined();
  });
});

describe('подсказка про части в инструкции', () => {
  const base = {
    role: 'Консультант', goals: [], tone: 'Дружелюбный', languages: ['ru'],
    forbidden: '', extraRules: '', advancedMode: false, advancedPrompt: '',
  };

  it('появляется только при включённой разбивке', () => {
    expect(buildSystemPrompt({ ...base, splitReplies: true }, { name: 'Demo' })).toContain('пустой строкой');
    expect(buildSystemPrompt({ ...base, splitReplies: false }, { name: 'Demo' })).not.toContain('пустой строкой');
    const manual = buildSystemPrompt({ ...base, advancedMode: true, advancedPrompt: 'Ты бот', splitReplies: true }, { name: 'Demo' });
    expect(manual).toContain('пустой строкой');
    expect(manual).toContain('не придумывай');
  });
});
