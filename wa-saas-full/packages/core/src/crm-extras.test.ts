import { describe, it, expect } from 'vitest';
import { stagesProblem, isStale, onShiftNow, cleanLostReasons, lostReasonsOf, LOST_REASONS, SHIFT_IDLE_MS, SHIFT_MAX_MS, sourceLabel } from './crm.js';
import { parseMetaWebhook } from '@wa/whatsapp';

const H = 3600_000;

describe('этапы: проверка перед сохранением', () => {
  const base = [
    { id: 'n', name: 'Новый', kind: 'NEW' as const },
    { id: 'w', name: 'У менеджера', kind: 'WORK' as const },
    { id: 'won', name: 'Выкупил', kind: 'WON' as const },
    { id: 'l', name: 'Отказ', kind: 'LOST' as const },
  ];

  it('нормальный список проходит, несколько финальных — тоже', () => {
    expect(stagesProblem(base, 'n')).toBeNull();
    expect(stagesProblem([...base, { id: null, name: 'Купил в рассрочку', kind: 'WON' }, { id: null, name: 'Не дозвонились', kind: 'LOST' }], 'n')).toBeNull();
  });
  it('нужен хотя бы один «Купил» и один «Отказ»', () => {
    expect(stagesProblem(base.filter((s) => s.kind !== 'WON'), 'n')).toMatch(/Купил/);
    expect(stagesProblem(base.filter((s) => s.kind !== 'LOST').concat({ id: null, name: 'x', kind: 'WORK' }), 'n')).toMatch(/Отказ/);
  });
  it('«Новый» всегда первый и один', () => {
    expect(stagesProblem([base[1]!, base[0]!, base[2]!, base[3]!], 'n')).toMatch(/Первым/);
    expect(stagesProblem([...base, { id: null, name: 'Ещё новый', kind: 'NEW' }], 'n')).toMatch(/только один/);
  });
  it('одинаковые и пустые названия не пропускает', () => {
    expect(stagesProblem([...base, { id: null, name: 'выкупил', kind: 'WON' }], 'n')).toMatch(/Два этапа/);
    expect(stagesProblem([...base, { id: null, name: '  ', kind: 'WORK' }], 'n')).toMatch(/название/);
  });
});

describe('зависшие клиенты', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const old = new Date(now.getTime() - 30 * H);
  it('в работе без движения больше суток — завис', () => {
    expect(isStale({ stageKind: 'WORK', stageChangedAt: old, lastMessageAt: old }, 24, now)).toBe(true);
  });
  it('переписка шла недавно — не завис', () => {
    expect(isStale({ stageKind: 'WORK', stageChangedAt: old, lastMessageAt: new Date(now.getTime() - H) }, 24, now)).toBe(false);
  });
  it('закрытые, «Новый» у бота и с будущим напоминанием — не зависшие', () => {
    expect(isStale({ stageKind: 'WON', stageChangedAt: old }, 24, now)).toBe(false);
    expect(isStale({ stageKind: 'NEW', stageChangedAt: old, botActive: true }, 24, now)).toBe(false);
    expect(isStale({ stageKind: 'NEW', stageChangedAt: old, botActive: false }, 24, now)).toBe(true);
    expect(isStale({ stageKind: 'WORK', stageChangedAt: old, remindAt: new Date(now.getTime() + H) }, 24, now)).toBe(false);
  });
});

describe('смена менеджера', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('на смене, пока панель открыта', () => {
    expect(onShiftNow({ onShift: true, shiftStartedAt: new Date(now.getTime() - 2 * H), lastSeenAt: new Date(now.getTime() - 60_000) }, now)).toBe(true);
  });
  it('закрыл панель — очередь пропускает', () => {
    expect(onShiftNow({ onShift: true, shiftStartedAt: new Date(now.getTime() - 2 * H), lastSeenAt: new Date(now.getTime() - SHIFT_IDLE_MS - 1000) }, now)).toBe(false);
  });
  it('забыл закончить смену — через 14 часов она кончилась', () => {
    expect(onShiftNow({ onShift: true, shiftStartedAt: new Date(now.getTime() - SHIFT_MAX_MS - 1000), lastSeenAt: now }, now)).toBe(false);
  });
  it('не на смене', () => {
    expect(onShiftNow({ onShift: false, shiftStartedAt: now, lastSeenAt: now }, now)).toBe(false);
  });
});

describe('причины отказа', () => {
  it('свой список чистится от пустых и повторов', () => {
    expect(cleanLostReasons([' Дорого ', 'дорого', '', 'Нет  размера'])).toEqual(['Дорого', 'Нет размера']);
  });
  it('пустой свой список — стандартный', () => {
    expect(lostReasonsOf({ lostReasons: [] })).toEqual(LOST_REASONS);
    expect(lostReasonsOf({ lostReasons: ['Далеко ехать'] })).toEqual(['Далеко ехать']);
  });
});

describe('реклама Click-to-WhatsApp', () => {
  it('referral из первого сообщения попадает во входящее', () => {
    const [m] = parseMetaWebhook({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'P1' },
        contacts: [{ wa_id: '77011234567', profile: { name: 'Айгерим' } }],
        messages: [{
          id: 'wamid.1', from: '77011234567', timestamp: '1762300000', type: 'text', text: { body: 'Здравствуйте! Хочу узнать подробнее' },
          referral: { source_url: 'https://fb.me/abc', source_id: '120210000', source_type: 'ad', headline: 'Зимние ботинки −30%', ctwa_clid: 'clid' },
        }],
      } }] }],
    });
    expect(m?.referral).toMatchObject({ sourceType: 'ad', sourceId: '120210000', headline: 'Зимние ботинки −30%', sourceUrl: 'https://fb.me/abc' });
    expect(sourceLabel({ source: 'ad', adHeadline: 'Зимние ботинки −30%' })).toBe('Зимние ботинки −30%');
    expect(sourceLabel({ source: 'whatsapp' })).toBe('WhatsApp напрямую');
  });
});
