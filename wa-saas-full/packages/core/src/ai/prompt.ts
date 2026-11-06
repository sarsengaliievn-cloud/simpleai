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
Отвечай ТОЛЬКО на основе фрагментов базы знаний, данных каталога (если они даны) и данных о компании.
Если нужной информации в них нет — не догадывайся и не придумывай.
В таком случае верни confidence не выше 30 и needs_human = true.
Никогда не выдумывай наличие товара, цены, сроки доставки, скидки и адреса.
Отвечай именно на то, что спросил клиент. Не добавляй цены, оплату, акции и другие сведения, о которых он не спрашивал, — даже если они есть во фрагментах.
Если фрагменты про другое и на вопрос не отвечают — needs_human = true, а не ответ «что нашлось».
Если пишет не покупатель — предлагает сотрудничество, рекламу, поставки, услуги, ищет работу — не рассказывай про товары: needs_human = true.`.trim();

const FORMAT = `
Ответ верни строго в формате JSON, без пояснений и без markdown-обёртки:
{"answer": "текст ответа клиенту", "confidence": 0-100, "sources": ["название документа"], "needs_human": true|false}
confidence — насколько ответ подтверждён фрагментами базы знаний, а не твоя уверенность в себе.`.trim();

const SPLIT_HINT =
  'Если ответ получается длинным, раздели его пустой строкой на 2–3 смысловые части — ' +
  'клиент получит их отдельными сообщениями, как от живого менеджера.';

/**
 * «Ты — {роль} компании «X».» Люди часто пишут в поле роли целую фразу:
 * «Ты — консультант магазина SHOQAI». Тогда «Ты —» и «компании «X»» не
 * дублируем — иначе модель получала «Ты — Ты — консультант … компании …».
 */
export function roleLine(rawRole: string, companyName: string) {
  const role = rawRole.trim().replace(/^ты\s*[—–-]\s*/i, '').replace(/[.!]+$/, '').trim() || 'консультант';
  const mentionsCompany = /компани|магазин|бренд|салон/i.test(role) || role.toLowerCase().includes(companyName.toLowerCase());
  return mentionsCompany ? `Ты — ${role}.` : `Ты — ${role} компании «${companyName}».`;
}

export function buildSystemPrompt(config: AIConfigLike, company: { name: string; description?: string | null; city?: string | null }) {
  if (config.advancedMode && config.advancedPrompt.trim()) {
    return [config.advancedPrompt.trim(), HARD_RULE, config.splitReplies ? SPLIT_HINT : '', FORMAT]
      .filter(Boolean).join('\n\n');
  }

  const languages = config.languages.map((l) => LANG[l] ?? l).join(', ');

  return [
    roleLine(config.role, company.name),
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
