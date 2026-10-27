import type { AIProvider } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider, openaiModel } from './openai.js';

/**
 * Какой ИИ отвечает. У каждой компании может быть свой (настройки
 * ассистента); если не выбран — по умолчанию сервера (AI_PROVIDER).
 * Эмбеддинги у Gemini и OpenAI живут в разных пространствах: сменили
 * семейство — базу знаний нужно переиндексировать.
 */
export type AIChoice = { provider: 'gemini' | 'openai' | 'anthropic'; model: string };

function geminiDefault() {
  const m = process.env.AI_MODEL ?? '';
  return /^gemini/i.test(m) ? m : 'gemini-3.6-flash';
}

export function defaultModelFor(provider: 'gemini' | 'openai') {
  return provider === 'gemini' ? geminiDefault() : openaiModel();
}

/** ИИ сервера по умолчанию — из AI_PROVIDER. */
export function serverDefault(): AIChoice {
  const name = (process.env.AI_PROVIDER ?? 'gemini').toLowerCase();
  if (name === 'openai' || name === 'chatgpt') return { provider: 'openai', model: openaiModel() };
  if (name === 'anthropic') return { provider: 'anthropic', model: process.env.AI_MODEL ?? 'claude-sonnet-4-6' };
  return { provider: 'gemini', model: geminiDefault() };
}

/** ИИ компании: её выбор из настроек ассистента или умолчание сервера. */
export function resolveAI(config?: { aiProvider?: string | null; aiModel?: string | null } | null): AIChoice {
  const p = config?.aiProvider;
  if (p === 'gemini' || p === 'openai') return { provider: p, model: config?.aiModel || defaultModelFor(p) };
  return serverDefault();
}

const instances = new Map<string, AIProvider>();

export function getAIFor(choice: AIChoice): AIProvider {
  const key = `${choice.provider}:${choice.model}`;
  const cached = instances.get(key);
  if (cached) return cached;

  let provider: AIProvider;
  if (choice.provider === 'gemini') {
    const transcribe = process.env.AI_TRANSCRIBE_MODEL ?? '';
    provider = new GeminiProvider(
      process.env.GEMINI_API_KEY ?? '',
      choice.model,
      process.env.AI_EMBED_MODEL ?? 'gemini-embedding-001',
      /^gemini/i.test(transcribe) ? transcribe : choice.model,
    );
  } else if (choice.provider === 'openai') {
    provider = new OpenAIProvider(process.env.OPENAI_API_KEY ?? '', choice.model);
  } else {
    provider = new AnthropicProvider();
  }
  instances.set(key, provider);
  return provider;
}

/** ИИ по умолчанию сервера — там, где компании нет (старый код, тесты). */
export function getAI(): AIProvider {
  return getAIFor(serverDefault());
}

/**
 * Чьи эмбеддинги в базе знаний. OpenAI и Anthropic считают их одной моделью
 * OpenAI — переход между ними индекс не ломает; с Gemini — ломает.
 */
export function embedFamily(choice: AIChoice = serverDefault()): 'gemini' | 'openai' {
  return choice.provider === 'gemini' ? 'gemini' : 'openai';
}

/** Чем сейчас отвечает ассистент — для подписи в панели. */
export function aiLabel(choice: AIChoice = serverDefault()): { provider: string; model: string } {
  const provider = choice.provider === 'openai' ? 'ChatGPT' : choice.provider === 'anthropic' ? 'Claude' : 'Gemini';
  return { provider, model: choice.model };
}

/** Провайдер для расчёта стоимости: Claude считаем по ценам OpenAI-семейства. */
export function billingProvider(choice: AIChoice): 'gemini' | 'openai' {
  return choice.provider === 'gemini' ? 'gemini' : 'openai';
}
