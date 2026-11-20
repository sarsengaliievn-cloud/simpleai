import { describe, it, expect, vi } from 'vitest';
const calls: any[] = [];
vi.mock('./ai/factory.js', () => ({
  resolveAI: () => ({ provider: 'x', model: 'm' }), billingProvider: () => 'x',
  getAIFor: () => ({
    embed: async (t: string[]) => t.map(() => [0]),
    generate: async (p: any) => {
      calls.push(p);
      if (/разбираешь сообщение/.test(p.system)) return { text: JSON.stringify({ query: 'Какой адрес магазина?', intent: 'info', lang: 'kk' }), inputTokens: 1, outputTokens: 1 };
      return { text: JSON.stringify({ answer: 'Алматы: Розыбакиева 208, Наурызбай батыр 28. Қай дүкенге, қашан келе аласыз?', confidence: 90, needs_human: false }), inputTokens: 1, outputTokens: 1 };
    },
  }),
}));
vi.mock('./catalog.js', async (orig) => {
  const m: any = await orig();
  return { ...m, loadCatalog: async () => m.normalizeCatalog({ stores: [
    { id: 'a', name: 'SHOQAI Мега', city: 'Алматы', address: 'Розыбакиева 208', phone: '+7 701 000 00 00' },
    { id: 'b', name: 'Наурызбай', city: 'Алматы', address: 'Наурызбай батыр 28' },
    { id: 'c', name: 'Хан Шатыр', city: 'Астана', address: 'Момышулы 2в' },
    { id: 'w', name: 'Центральный склад', city: 'Алматы', address: 'Складская 1', warehouse: true }], items: [] }) };
});
import { ADDRESS_Q, answerQuestion } from './ai/rag.js';
import { defaultStageHint } from './stage-ai.js';

describe('адреса', () => {
  it('узнаёт вопрос', () => {
    for (const q of ['Адрес қандай', 'Қайда орналасқансыздар?', 'где вы находитесь', 'до скольки работаете', 'жұмыс уақыты қандай', 'как до вас доехать', 'дүкендеріңіз қайда', 'как вас найти'])
      expect(ADDRESS_Q.test(q), q).toBe(true);
    for (const q of ['41 размер бар ма', 'сколько стоит', 'Ассалаумалейкум', 'хочу заказать'])
      expect(ADDRESS_Q.test(q), q).toBe(false);
  });
  it('отвечает по складу, без менеджера, и спрашивает, придёт ли', async () => {
    const r = await answerQuestion({ companyId: 'c', company: { name: 'SHOQAI' }, question: 'Адрес қандай',
      config: { role: '', goals: [], tone: 'дружелюбный', languages: ['ru', 'kk'], forbidden: '', extraRules: '', advancedMode: false, advancedPrompt: '', confidenceThreshold: 50 },
      catalog: { url: 'https://x.kz/c.json', productUrl: '', photoUrl: '' } as any });
    expect(r.needsHuman).toBe(false);
    expect(r.confidence).toBe(90);
    const sent = calls.at(-1).messages.at(-1).content as string;
    expect(sent).toContain('Розыбакиева 208');
    expect(sent).toContain('тел. +7 701');
    expect(sent).toContain('Момышулы 2в');
    expect(sent).not.toContain('Складская');
    expect(sent).toContain('Қай дүкенге, қашан келе аласыз');
  });
  it('этап «Придет в магазин» понимает короткое «иә»', () => {
    expect(defaultStageHint('Придет в магазин', 'WORK')).toMatch(/иә/);
  });
});
describe('заказ ≠ адрес', () => {
  it('«тапсырысым қайда» не тянет адреса', async () => {
    calls.length = 0;
    await answerQuestion({ companyId: 'c', company: { name: 'SHOQAI' }, question: 'тапсырысым қайда',
      config: { role: '', goals: [], tone: 'дружелюбный', languages: ['ru'], forbidden: '', extraRules: '', advancedMode: false, advancedPrompt: '', confidenceThreshold: 50 },
      catalog: { url: 'https://x.kz/c.json', productUrl: '', photoUrl: '' } as any });
    expect(calls.some((c) => JSON.stringify(c.messages).includes('МАГАЗИНЫ'))).toBe(false);
  });
});
