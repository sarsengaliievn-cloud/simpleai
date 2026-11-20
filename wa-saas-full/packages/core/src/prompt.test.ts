import { describe, it, expect } from 'vitest';
import { roleLine } from './ai/prompt.js';
import { aiErrorReason } from './ai/errors.js';

describe('Роль в инструкции без склейки', () => {
  it('обычная роль — добавляем компанию', () => expect(roleLine('Консультант', 'Shoqai')).toBe('Ты — Консультант компании «Shoqai».'));
  it('роль с «Ты —» и магазином — без дублей', () =>
    expect(roleLine('Ты — онлайн-консультант магазина обуви SHOQAI!', 'Shoqai')).toBe('Ты — онлайн-консультант магазина обуви SHOQAI.'));
  it('пустая роль', () => expect(roleLine('  ', 'X')).toBe('Ты — консультант компании «X».'));
});

describe('Понятная причина сбоя ИИ', () => {
  it('модель недоступна', () => expect(aiErrorReason('Gemini 404: models/gemini-2.5-flash is not found for API version v1beta', 'gemini-2.5-flash')).toMatch(/Модель gemini-2.5-flash недоступна/));
  it('неверный ключ OpenAI', () => expect(aiErrorReason('OpenAI (эмбеддинги) вернул 401: Incorrect API key provided')).toBe('Ключ OpenAI на сервере неверный или отключён'));
  it('нет денег', () => expect(aiErrorReason('OpenAI 429 insufficient_quota')).toMatch(/закончились деньги/));
  it('неизвестное', () => expect(aiErrorReason('что-то странное')).toBe('Ассистент не смог подготовить ответ'));
});

import { dialogNote } from './ai/rag.js';
import { buildSystemPrompt as build2 } from './ai/prompt.js';

describe('не засыпать клиента', () => {
  const cfg = { role: 'консультант', goals: [], tone: 'Дружелюбный', languages: ['ru'], forbidden: '', extraRules: '', advancedMode: false, advancedPrompt: '' };

  it('после первого ответа — без приветствия и повторов', () => {
    const note = dialogNote([{ role: 'user', content: 'Сәлем' }, { role: 'assistant', content: 'Сәлеметсіз бе!' }], 'Рассрочка бар ма');
    expect(note).toContain('не здоровайся');
    expect(dialogNote([], 'Привет')).toBe('');
  });

  it('серия сообщений — один ответ на все вопросы', () => {
    expect(dialogNote([], '42 р керек\nКласикалык модель\nРассрочка бар ма')).toContain('одним коротким сообщением');
  });

  it('правило переписки есть и в продвинутом режиме', () => {
    expect(build2(cfg, { name: 'Demo' })).toContain('только в первом ответе');
    expect(build2({ ...cfg, advancedMode: true, advancedPrompt: 'Представься и дай каталог' }, { name: 'Demo' })).toContain('только в первом ответе');
  });
});

import { resolveAI, currentModel } from './ai/factory.js';
describe('снятые модели Google', () => {
  it('Gemini 2.5 Flash заменяется на актуальную', () => {
    expect(currentModel('gemini-2.5-flash')).toBe('gemini-3.6-flash');
    expect(resolveAI({ aiProvider: 'gemini', aiModel: 'gemini-2.5-flash' }).model).toBe('gemini-3.6-flash');
    expect(resolveAI({ aiProvider: 'gemini', aiModel: 'gemini-3.6-flash' }).model).toBe('gemini-3.6-flash');
    expect(resolveAI({ aiProvider: 'openai', aiModel: 'gpt-5-mini' }).model).toBe('gpt-5-mini');
  });
});

import { isSmallTalk } from './ai/rag.js';
describe('приветствие + вопрос', () => {
  it('приветствие узнаётся отдельно, вопрос — нет', () => {
    expect(isSmallTalk('Қайырлы кеш')).toBe(true);
    expect(isSmallTalk('Астанаға доставка барма')).toBe(false);
  });
  it('язык клиента — явно', () => {
    expect(dialogNote([], 'Астанаға доставка барма', 'kk')).toContain('по-казахски');
  });
});

import { MANAGER_ONLY_Q, clientLang } from './ai/rag.js';
describe('возврат и язык', () => {
  it('возврат, обмен, брак — менеджеру', () => {
    for (const q of ['Возврат жасауға болама размері үлкен болып тұр', '41 размер бірақ прям үлкен болып тұр', 'можно обменять на 42?', 'Аяқ киімді қайтаруға бола ма', 'подошва отклеилась, брак']) expect(MANAGER_ONLY_Q.test(q)).toBe(true);
    for (const q of ['Канша багасы', 'Астанаға доставка барма', '42 размер есть?', 'Каталог жіберіңізші']) expect(MANAGER_ONLY_Q.test(q)).toBe(false);
  });
  it('казахские буквы — казахский', () => {
    expect(clientLang('41 размер бірақ прям үлкен', 'ru')).toBe('kk');
    expect(clientLang('Канша багасы', 'kk')).toBe('kk');
    expect(clientLang('Сколько стоит', 'ru')).toBe('ru');
  });
});
