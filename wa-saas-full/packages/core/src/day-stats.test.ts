import { describe, it, expect } from 'vitest';
import { resolvePeriod, startOfDayKey, dayTable, firstReplyMinutes, dayKeyOf } from './day-stats.js';
import { joinChunks, knowledgeExport, parseKnowledgeFile, sameText } from './knowledge-file.js';
import { chunkText } from './ai/chunk.js';

const TZ = 'Asia/Almaty'; // UTC+5
const now = new Date('2026-11-18T16:20:00Z'); // 21:20 по Алматы

describe('период', () => {
  it('сегодня — с полуночи по Алматы до сейчас', () => {
    const p = resolvePeriod({ d: 'today' }, TZ, now);
    expect(p.keys).toEqual(['2026-11-18']);
    expect(p.from.toISOString()).toBe('2026-11-17T19:00:00.000Z');
    expect(p.to).toBe(now);
  });
  it('вчера — целые сутки', () => {
    const p = resolvePeriod({ d: 'yesterday' }, TZ, now);
    expect(p.keys).toEqual(['2026-11-17']);
    expect(p.to.toISOString()).toBe('2026-11-17T19:00:00.000Z');
  });
  it('7 дней — сегодня и шесть предыдущих', () => {
    const p = resolvePeriod({ d: '7' }, TZ, now);
    expect(p.keys[0]).toBe('2026-11-12');
    expect(p.keys).toHaveLength(7);
  });
  it('свои даты: порядок не важен, будущее обрезается', () => {
    const p = resolvePeriod({ from: '2026-11-20', to: '2026-11-10' }, TZ, now);
    expect(p.id).toBe('custom');
    expect(p.fromKey).toBe('2026-11-10');
    expect(p.toKey).toBe('2026-11-18');
  });
  it('ночная заявка попадает в свой день', () => {
    expect(dayKeyOf(new Date('2026-11-17T19:30:00Z'), TZ)).toBe('2026-11-18');
    expect(startOfDayKey('2026-03-29', 'Europe/Berlin').toISOString()).toBe('2026-03-28T23:00:00.000Z');
  });
});

describe('таблица по дням', () => {
  const at = (h: string) => new Date(`2026-11-18T${h}:00+05:00`);
  it('лиды, заказы, конверсия, выкуп и отмены', () => {
    const { rows, total } = dayTable(['2026-11-17', '2026-11-18'], TZ, {
      leads: [
        { createdAt: at('10:00'), ad: true, archived: false, answeredInMin: 2 },
        { createdAt: at('11:00'), ad: false, archived: false, answeredInMin: 40 },
        { createdAt: at('12:00'), ad: false, archived: false, answeredInMin: null },
        { createdAt: at('13:00'), ad: false, archived: true, answeredInMin: 1 },
        { createdAt: new Date('2026-11-17T10:00:00+05:00'), ad: false, archived: false, answeredInMin: 0 },
      ],
      orders: [
        { orderedAt: at('15:00'), total: 30000, status: 'completed' },
        { orderedAt: at('16:00'), total: 20000, status: 'shipped' },
        { orderedAt: at('17:00'), total: 10000, status: 'cancelled' },
      ],
      lostAt: [at('18:00')],
    });
    const d = rows[1]!;
    expect(d).toMatchObject({ leads: 3, fromAds: 1, answeredFast: 1, unanswered: 1, orders: 2, revenue: 50000, completed: 1, cancelled: 1, lost: 1, averageCheck: 25000 });
    expect(d.conversion).toBe(66.7);
    expect(rows[0]!.leads).toBe(1);
    expect(total.leads).toBe(4);
    expect(total.conversion).toBe(50);
  });
  it('первый ответ', () => {
    const c = new Date('2026-11-18T10:00:00Z');
    expect(firstReplyMinutes(c, [new Date('2026-11-18T09:00:00Z'), new Date('2026-11-18T10:07:00Z')])).toBe(7);
    expect(firstReplyMinutes(c, [])).toBeNull();
    expect(firstReplyMinutes(c, undefined)).toBeNull();
  });
});

describe('база знаний файлом', () => {
  it('фрагменты склеиваются обратно без повторов', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Абзац ${i + 1}. ${'Доставка по Казахстану Казпочтой, оплата Kaspi, примерка в магазине. '.repeat(3)}`).join('\n\n');
    const back = joinChunks(chunkText(text));
    expect(sameText(back, text)).toBe(true);
  });
  it('выгрузка и обратный разбор', () => {
    const file = knowledgeExport('SHOQAI', [
      { id: 'a1b2c3d4-0000-0000-0000-000000000000', title: 'Доставка', text: 'Казпочта 3–5 дней.' },
      { id: 'ffeeddcc-0000-0000-0000-000000000000', title: 'Рассрочка', text: 'Kaspi Red 0-0-12.' },
    ]);
    const edited = file.replace('Kaspi Red 0-0-12.', 'Kaspi Red 0-0-24.') + '\n===== ДОКУМЕНТ: Адреса =====\nРозыбакиева 1.\n';
    const s = parseKnowledgeFile(`﻿${edited.replace(/\n/g, '\r\n')}`)!;
    expect(s.map((x) => [x.title, x.idPrefix, x.text])).toEqual([
      ['Доставка', 'a1b2c3d4', 'Казпочта 3–5 дней.'],
      ['Рассрочка', 'ffeeddcc', 'Kaspi Red 0-0-24.'],
      ['Адреса', null, 'Розыбакиева 1.'],
    ]);
    expect(parseKnowledgeFile('просто прайс')).toBeNull();
  });
});
