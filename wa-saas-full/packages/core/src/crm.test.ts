import { describe, it, expect } from 'vitest';
import { funnel, formatMoney, parseAmount, stageMoveProblem, type FunnelDeal } from './crm.js';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const deal = (over: Partial<FunnelDeal>): FunnelDeal => ({
  createdAt: d('2026-10-01'), assignedAt: null, orderedAt: null, wonAt: null, lostAt: null,
  amount: null, lostReason: null, assigneeId: null, ...over,
});

describe('CRM: суммы', () => {
  it('разбирает сумму в любом виде', () => {
    expect(parseAmount('12 500')).toBe(12500);
    expect(parseAmount('12500 тг')).toBe(12500);
    expect(parseAmount('12.500')).toBe(12500);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('ноль')).toBeNull();
    expect(parseAmount('0')).toBeNull();
  });
  it('показывает сумму с пробелами и знаком тенге', () => {
    expect(formatMoney(12500)).toBe('12 500 ₸');
    expect(formatMoney(null)).toBe('—');
  });
});

describe('CRM: переход между этапами', () => {
  it('заказ требует сумму и товар', () => {
    expect(stageMoveProblem('ORDER', {})).toBe('Укажите сумму заказа');
    expect(stageMoveProblem('ORDER', { amount: 15000 })).toBe('Укажите товар');
    expect(stageMoveProblem('ORDER', { amount: 15000, product: 'Nike Air, 42' })).toBeNull();
  });
  it('отказ требует причину', () => {
    expect(stageMoveProblem('LOST', { lostReason: '  ' })).toBe('Укажите причину отказа');
    expect(stageMoveProblem('LOST', { lostReason: 'Дорого' })).toBeNull();
  });
  it('остальные этапы — без условий', () => {
    expect(stageMoveProblem('WORK', {})).toBeNull();
    expect(stageMoveProblem('WON', {})).toBeNull();
  });
});

describe('CRM: воронка за период', () => {
  const from = d('2026-10-01');
  const to = d('2026-11-01');
  const deals = [
    deal({ createdAt: d('2026-10-02'), assignedAt: d('2026-10-02'), orderedAt: d('2026-10-03'), amount: 20000 }),
    deal({ createdAt: d('2026-10-05'), assignedAt: d('2026-10-05'), orderedAt: d('2026-10-06'), wonAt: d('2026-10-08'), amount: 10000 }),
    deal({ createdAt: d('2026-10-07'), lostAt: d('2026-10-09'), lostReason: 'Дорого' }),
    deal({ createdAt: d('2026-10-10'), lostAt: d('2026-10-11'), lostReason: 'Дорого' }),
    deal({ createdAt: d('2026-10-12') }),
    // Клиент из сентября, заказ в октябре — заказ идёт в октябрь.
    deal({ createdAt: d('2026-09-20'), orderedAt: d('2026-10-15'), amount: 30000 }),
    // Целиком в ноябре — мимо периода.
    deal({ createdAt: d('2026-11-02'), orderedAt: d('2026-11-03'), amount: 99999 }),
  ];
  const f = funnel(deals, from, to);

  it('считает шаги по датам событий в периоде', () => {
    expect(f).toMatchObject({ created: 5, assigned: 2, ordered: 3, won: 1, lost: 2 });
  });
  it('выручка, средний чек и конверсия', () => {
    expect(f.revenue).toBe(60000);
    expect(f.averageCheck).toBe(20000);
    expect(f.conversion).toBe(60); // 3 заказа на 5 обращений
  });
  it('причины отказа по убыванию', () => {
    expect(f.lostReasons).toEqual([['Дорого', 2]]);
  });
  it('пустой период не делит на ноль', () => {
    expect(funnel([], from, to)).toMatchObject({ conversion: 0, averageCheck: 0, revenue: 0 });
  });
});
