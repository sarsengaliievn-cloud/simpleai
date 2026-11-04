/**
 * Человеческая причина сбоя ИИ — по тексту ошибки провайдера. Её видит
 * владелец: в тестовом чате, в плашке «ИИ не работает» и в пометке
 * диалога, который бот из-за сбоя передал менеджеру.
 */
export function aiErrorReason(raw: string, model?: string | null): string {
  const text = raw ?? '';
  const provider = /openai|gpt-/i.test(text) ? 'OpenAI' : /gemini|google|generativelanguage/i.test(text) ? 'Gemini' : 'ИИ';
  if (/API_KEY|не задан/i.test(text) && !/invalid|not valid/i.test(text)) return `На сервере не задан ключ ${provider}`;
  if (/\b401\b|\b403\b|invalid_api_key|API key not valid|Incorrect API key|PERMISSION_DENIED/i.test(text)) {
    return `Ключ ${provider} на сервере неверный или отключён`;
  }
  if (/insufficient_quota|exceeded your current quota|billing/i.test(text)) return `На счету ${provider} закончились деньги`;
  if (/\b404\b|NOT_FOUND|not found|is not supported|no longer available|deprecated|does not exist/i.test(text)) {
    return `Модель ${model ?? ''} недоступна для этого ключа — выберите другую в «Как отвечает»`.replace('  ', ' ');
  }
  if (/\b429\b|rate limit|RESOURCE_EXHAUSTED/i.test(text)) return `${provider} временно ограничил запросы`;
  if (/\b5\d\d\b|UNAVAILABLE|overloaded|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(text)) return `${provider} не ответил (сбой у провайдера или сети)`;
  return 'Ассистент не смог подготовить ответ';
}
