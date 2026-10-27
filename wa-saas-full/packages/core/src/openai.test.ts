import { describe, it, expect, afterEach } from 'vitest';
import { responsesText, openaiModel } from './ai/openai.js';
import { embedFamily, aiLabel } from './ai/factory.js';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('ChatGPT (OpenAI)', () => {
  it('берёт только итоговый ответ, без рассуждений модели', () => {
    const text = responsesText({
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'думаю…' }] },
        { type: 'message', content: [{ type: 'output_text', text: '{"answer":"Да",' }, { type: 'output_text', text: '"confidence":90}' }] },
      ],
    });
    expect(text).toBe('{"answer":"Да","confidence":90}');
  });

  it('понимает и короткое поле output_text', () => {
    expect(responsesText({ output_text: ' {"answer":"ok"} ' })).toBe('{"answer":"ok"}');
    expect(responsesText({})).toBe('');
  });

  it('не отправляет в OpenAI модель Gemini, оставшуюся в AI_MODEL', () => {
    process.env.AI_MODEL = 'gemini-3.6-flash';
    delete process.env.OPENAI_MODEL;
    expect(openaiModel()).toBe('gpt-5-mini');
    process.env.AI_MODEL = 'gpt-4.1-mini';
    expect(openaiModel()).toBe('gpt-4.1-mini');
    process.env.OPENAI_MODEL = 'gpt-5';
    expect(openaiModel()).toBe('gpt-5');
  });

  it('смена Gemini ↔ ChatGPT требует обновить индекс, ChatGPT ↔ Claude — нет', () => {
    process.env.AI_PROVIDER = 'gemini';
    expect(embedFamily()).toBe('gemini');
    process.env.AI_PROVIDER = 'openai';
    expect(embedFamily()).toBe('openai');
    process.env.AI_PROVIDER = 'anthropic';
    expect(embedFamily()).toBe('openai');
  });

  it('подпись в панели', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_MODEL = 'gpt-5-mini';
    expect(aiLabel()).toEqual({ provider: 'ChatGPT', model: 'gpt-5-mini' });
  });
});
