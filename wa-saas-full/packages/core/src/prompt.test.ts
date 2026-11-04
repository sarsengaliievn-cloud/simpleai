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
