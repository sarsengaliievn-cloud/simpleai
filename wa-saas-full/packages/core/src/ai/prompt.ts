export type AIConfigLike = {
  role: string;
  goals: string[];
  tone: string;
  languages: string[];
  forbidden: string;
  extraRules: string;
  advancedMode: boolean;
  advancedPrompt: string;
  /** Длинный ответ уходит клиенту несколькими сообщениями. */
  splitReplies?: boolean;
};

const LANG: Record<string, string> = { ru: 'русском', kk: 'казахском', en: 'английском' };

/**
 * Правило про «не выдумывай» дописывается всегда — даже в режиме
 * продвинутой инструкции. Это единственный запрет, который пользователь
 * не может отключить: без него продукт превращается в генератор обещаний,
 * за которые отвечает бизнес.
 */
const HARD_RULE = `
Отвечай ТОЛЬКО на основе фрагментов базы знаний, приведённых ниже, и данных о компании.
Если нужной информации в них нет — не догадывайся и не придумывай.
В таком случае верни confidence не выше 30 и needs_human = true.
Никогда не выдумывай наличие товара, цены, сроки доставки, скидки и адреса.`.trim();

const FORMAT = `
Ответ верни строго в формате JSON, без пояснений и без markdown-обёртки:
{"answer": "текст ответа клиенту", "confidence": 0-100, "sources": ["название документа"], "needs_human": true|false}
confidence — насколько ответ подтверждён фрагментами базы знаний, а не твоя уверенность в себе.`.trim();

const SPLIT_HINT =
  'Если ответ получается длинным, раздели его пустой строкой на 2–3 смысловые части — ' +
  'клиент получит их отдельными сообщениями, как от живого менеджера.';

export function buildSystemPrompt(config: AIConfigLike, company: { name: string; description?: string | null; city?: string | null }) {
  if (config.advancedMode && config.advancedPrompt.trim()) {
    return [config.advancedPrompt.trim(), HARD_RULE, config.splitReplies ? SPLIT_HINT : '', FORMAT]
      .filter(Boolean).join('\n\n');
  }

  const languages = config.languages.map((l) => LANG[l] ?? l).join(', ');

  return [
    `Ты — ${config.role} компании «${company.name}».`,
    company.description ? `О компании: ${company.description}` : '',
    company.city ? `Город: ${company.city}.` : '',
    '',
    `Стиль общения: ${config.tone.toLowerCase()}. Обращайся к клиенту на «вы».`,
    `Отвечай на языке клиента (${languages}). Если клиент пишет на казахском — отвечай на казахском.`,
    config.goals.length ? `Твои задачи: ${config.goals.join('; ')}.` : '',
    config.forbidden.trim() ? `Запрещено: ${config.forbidden.trim()}` : '',
    config.extraRules.trim() ? `Дополнительно: ${config.extraRules.trim()}` : '',
    '',
    HARD_RULE,
    '',
    'Пиши коротко, как в мессенджере: 1–3 предложения, без списков и заголовков.',
    config.splitReplies ? SPLIT_HINT : '',
    '',
    FORMAT,
  ].filter(Boolean).join('\n');
}
