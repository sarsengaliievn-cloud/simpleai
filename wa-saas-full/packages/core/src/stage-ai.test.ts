import { describe, it, expect } from 'vitest';
import { aiStageOptions, skladStageIds, aiMoveAllowed, parseStageVerdict, stageTranscript, stagePrompt, classifyStage, defaultStageHint } from './stage-ai.js';

const SHOQAI = [
  ['s1', 'Новый', 'NEW'], ['s2', 'Уточнял график работы', 'WORK'], ['s3', 'У менеджера', 'WORK'], ['s4', 'отправлен каталог', 'WORK'],
  ['s5', 'Думает', 'WORK'], ['s6', 'Ждем оплату', 'WORK'], ['s7', 'Продажа', 'WORK'], ['s8', 'Выкупил', 'WON'],
  ['s9', 'Придет в магазин', 'WORK'], ['s10', 'Нету ответа отказ', 'LOST'],
].map(([id, name, kind], position) => ({ id: id!, name: name!, kind: kind!, position, aiHint: null as string | null }));
const st = (id: string) => SHOQAI.find((s) => s.id === id)!;

describe('ИИ и этапы: что можно ставить', () => {
  const opts = aiStageOptions(SHOQAI);
  it('продажи, «Новый» и «У менеджера» — не ИИ', () => {
    expect(opts.map((o) => o.name)).toEqual(['Уточнял график работы', 'отправлен каталог', 'Думает', 'Ждем оплату', 'Придет в магазин', 'Нету ответа отказ']);
    expect([...skladStageIds(SHOQAI)].sort()).toEqual(['s7', 's8']);
  });
  it('подсказки по названиям', () => {
    expect(defaultStageHint('Думает', 'WORK')).toMatch(/подумаю/);
    expect(defaultStageHint('отправлен каталог', 'WORK')).toMatch(/каталог/);
    expect(defaultStageHint('Нету ответа отказ', 'LOST')).toMatch(/перестал отвечать/);
    expect(defaultStageHint('Что-то своё', 'WORK')).toBe('');
  });
  it('своя подсказка важнее, «-» выключает этап', () => {
    const custom = SHOQAI.map((s) => (s.id === 's5' ? { ...s, aiHint: '-' } : s.id === 's9' ? { ...s, aiHint: 'клиент записался на примерку' } : s));
    const o = aiStageOptions(custom);
    expect(o.some((x) => x.id === 's5')).toBe(false);
    expect(o.find((x) => x.id === 's9')!.hint).toBe('клиент записался на примерку');
  });
});

describe('ИИ и этапы: куда можно двигать', () => {
  const opts = aiStageOptions(SHOQAI);
  const o = (id: string) => opts.find((x) => x.id === id)!;
  const sklad = skladStageIds(SHOQAI);
  const now = new Date('2026-11-19T10:00:00Z');
  it('только вперёд', () => {
    expect(aiMoveAllowed(st('s1'), o('s4'), sklad, null, now)).toBe(true);
    expect(aiMoveAllowed(st('s5'), o('s4'), sklad, null, now)).toBe(false);
    expect(aiMoveAllowed(st('s3'), o('s5'), sklad, null, now)).toBe(true); // от менеджера — вперёд можно
  });
  it('в отказ — из любого открытого, из продажи — нет', () => {
    expect(aiMoveAllowed(st('s9'), o('s10'), sklad, null, now)).toBe(true);
    expect(aiMoveAllowed(st('s7'), o('s10'), sklad, null, now)).toBe(false);
    expect(aiMoveAllowed(st('s8'), o('s10'), sklad, null, now)).toBe(false);
  });
  it('сутки после ручного переноса — не трогаем', () => {
    expect(aiMoveAllowed(st('s2'), o('s5'), sklad, new Date('2026-11-19T01:00:00Z'), now)).toBe(false);
    expect(aiMoveAllowed(st('s2'), o('s5'), sklad, new Date('2026-11-17T01:00:00Z'), now)).toBe(true);
  });
});

describe('ИИ и этапы: ответ модели', () => {
  const opts = aiStageOptions(SHOQAI);
  it('разбор', () => {
    expect(parseStageVerdict('```json\n{"stage": 3, "reason": "клиент: ойланып көрейін", "lost_reason": ""}\n```', opts)).toEqual({ stageId: 's5', reason: 'клиент: ойланып көрейін', lostReason: '' });
    expect(parseStageVerdict('{"stage": 0}', opts).stageId).toBeNull();
    expect(parseStageVerdict('{"stage": 99}', opts).stageId).toBeNull();
    expect(parseStageVerdict('не json', opts).stageId).toBeNull();
  });
  it('переписка и промпт', () => {
    const t = stageTranscript([
      { direction: 'INBOUND', authorType: 'CUSTOMER', type: 'TEXT', text: 'Сәлем, 42 бар ма?' },
      { direction: 'OUTBOUND', authorType: 'AI', type: 'IMAGE', text: 'Вот модели' },
      { direction: 'OUTBOUND', authorType: 'SYSTEM', type: 'TEXT', text: 'Диалог передан менеджеру' },
      { direction: 'INBOUND', authorType: 'CUSTOMER', type: 'TEXT', text: 'Ойланып көрейін' },
    ]);
    expect(t).toBe('Клиент: Сәлем, 42 бар ма?\nМагазин (бот): [фото] Вот модели\nКлиент: Ойланып көрейін');
    expect(stagePrompt(opts, 'Новый')).toMatch(/3 — Думает — клиент получил цену/);
  });
  it('запрос к модели', async () => {
    const ai = { name: 'fake', generate: async () => ({ text: '{"stage": 3, "reason": "подумает"}', inputTokens: 300, outputTokens: 20 }), embed: async () => [], transcribe: async () => '' };
    const r = await classifyStage(ai, opts, 'Новый', 'Клиент: подумаю');
    expect(r.verdict.stageId).toBe('s5');
    expect(r.usage.inputTokens).toBe(300);
  });
});

import { funnelAskBlock, defaultStageAsk } from './stage-ai.js';
describe('бот спрашивает, чтобы двигать клиента', () => {
  it('после адреса — «придёте в магазин?», после каталога — какая модель', () => {
    expect(defaultStageAsk('Уточнял график работы', 'WORK')).toMatch(/Придёте/);
    expect(defaultStageAsk('отправлен каталог', 'WORK')).toMatch(/модель/);
    expect(defaultStageAsk('Думает', 'WORK')).toBe('');
    const b = funnelAskBlock(SHOQAI);
    expect(b).toMatch(/адрес магазина.*Придёте к нам в магазин/);
    expect(b).not.toMatch(/Продажа/);
  });
  it('свой вопрос и «-»', () => {
    const custom = SHOQAI.map((s) => (s.id === 's2' ? { ...s, aiAsk: '-' } : s.id === 's9' ? { ...s, aiAsk: 'В какой день вас ждать?' } : s));
    const b = funnelAskBlock(custom);
    expect(b).not.toMatch(/Придёте к нам/);
    expect(b).toMatch(/В какой день вас ждать/);
  });
});
