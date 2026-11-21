import { describe, it, expect } from 'vitest';
import { emptyLead, mergeLead, toLead, leadMissing, leadNote, leadLines, leadFromUnderstanding, leadStarted } from './lead.js';

describe('заявка', () => {
  it('спрашиваем по порядку: имя → что хочет → размер → город → получение → оплата', () => {
    expect(leadMissing(emptyLead())).toEqual(['name', 'want', 'size', 'city', 'delivery', 'payment']);
    const l = mergeLead(emptyLead(), { name: 'Айгерім', want: 'етік, ұзын қонышты' });
    expect(leadMissing(l)).toEqual(['size', 'city', 'delivery', 'payment']);
  });
  it('адрес нужен после выбора доставки; для самовывоза — какой магазин', () => {
    const d = mergeLead(emptyLead(), { name: 'А', want: 'ботинки', size: '38', city: 'Астана', delivery: 'курьер' });
    expect(leadMissing(d)).toEqual(['address', 'payment']);
    expect(leadNote(d)).toMatch(/адрес доставки и как удобнее оплатить/);
    const p = mergeLead(d, { delivery: 'заберу в магазине' });
    expect(leadNote(p)).toMatch(/в какой магазин придёт/);
    expect(leadLines(mergeLead(p, { address: 'Хан Шатыр' }))).toContain('Магазин: Хан Шатыр');
  });
  it('новое не стирается пустым, старое помнится', () => {
    const l = mergeLead(mergeLead(emptyLead(), { name: 'Нұржан', size: '42' }), { name: '', size: '', city: 'Алматы' });
    expect(l).toMatchObject({ name: 'Нұржан', size: '42', city: 'Алматы' });
    expect(toLead({ ...l, junk: 1, size: 42 })).toMatchObject({ name: 'Нұржан', size: '' });
  });
  it('подсказка модели: не переспрашивать известное, максимум два пункта, без брони', () => {
    const l = mergeLead(emptyLead(), { want: 'етік' });
    const note = leadNote(l);
    expect(note).toMatch(/Уже известно — не переспрашивай: Что хочет: етік/);
    expect(note).toMatch(/спроси.*: имя и размер\./);
    expect(note).toMatch(/без предложения брони/);
  });
  it('из разбора сообщения: размер числом, модель из вида и сезона', () => {
    const u = { query: '', intent: 'buy' as const, lang: 'kk' as const, article: '', model: '', size: '38 размер', gender: '', kind: 'етік', season: 'қыс', color: '', maxPrice: null, city: '', delivery: '', payment: '', name: 'Дана' };
    expect(leadFromUnderstanding(u)).toMatchObject({ size: '38', want: 'етік, қыс', name: 'Дана' });
    expect(leadStarted(emptyLead())).toBe(false);
  });
});
