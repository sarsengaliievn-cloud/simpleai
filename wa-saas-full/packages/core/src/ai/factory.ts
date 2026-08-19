import type { AIProvider } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';

let provider: AIProvider | null = null;

/**
 * Выбор провайдера через AI_PROVIDER: gemini или anthropic.
 * Важно: эмбеддинги у провайдеров живут в разных пространствах, поэтому
 * после смены провайдера базу знаний нужно переиндексировать —
 * старые векторы станут бессмысленными.
 */
export function getAI(): AIProvider {
  if (provider) return provider;

  const name = (process.env.AI_PROVIDER ?? 'gemini').toLowerCase();

  switch (name) {
    case 'gemini':
      provider = new GeminiProvider();
      break;
    case 'anthropic':
      provider = new AnthropicProvider();
      break;
    default:
      throw new Error(`Неизвестный AI_PROVIDER: ${name}. Доступны: gemini, anthropic.`);
  }

  return provider;
}
