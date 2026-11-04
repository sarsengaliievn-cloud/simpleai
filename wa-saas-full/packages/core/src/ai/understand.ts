import type { AIProvider, ChatMessage } from './provider.js';

/**
 * Разбор сообщения клиента перед ответом. Клиенты пишут разговорно, на
 * смеси казахского и русского, с опечатками и ссылками на прошлое
 * («а 42 есть?»). Модель переписывает вопрос нормально и вытаскивает то,
 * что нужно для склада и для передачи менеджеру: модель, размер, город.
 */

export type Intent = 'stock' | 'pick' | 'buy' | 'info' | 'other';

export type Understanding = {
  /** Вопрос клиента полностью, по-русски, с учётом прошлых сообщений — по нему ищем в базе знаний. */
  query: string;
  intent: Intent;
  lang: 'ru' | 'kk';
  article: string;
  model: string;
  size: string;
  gender: string;
  season: string;
  color: string;
  maxPrice: number | null;
  city: string;
  delivery: string;
  payment: string;
};

const PROMPT = `Ты разбираешь сообщение клиента интернет-магазина перед ответом. Клиент пишет в WhatsApp на русском, казахском или их смеси, разговорно, с ошибками.
Учитывай всю переписку: «а 42 есть?» относится к модели, о которой говорили раньше; модель, размер и город могли прозвучать в прошлых сообщениях.

Верни строго один JSON-объект (json), без пояснений:
{"query": "...", "intent": "stock|pick|buy|info|other", "lang": "ru|kk", "article": "", "model": "", "size": "", "gender": "m|w|kids|", "season": "", "color": "", "max_price": 0, "city": "", "delivery": "", "payment": ""}

query — что спрашивает клиент, одним понятным предложением на русском, с подставленным контекстом. Пример: «41 размер бар ма, қанша тұрады» → «Есть ли 41 размер этой модели и сколько она стоит?».
intent:
- stock — спрашивает, есть ли конкретная модель или размер;
- pick — просит подобрать или показать варианты (сезон, пол, размер, бюджет);
- buy — готов купить или оформить: «беру», «хочу заказать», «как оплатить», «алам», «аламын», «тапсырыс беремін», «оформите»;
- info — вопрос о доставке, оплате, адресах, обмене, акциях и т.п.;
- other — всё остальное.
lang — kk, если клиент пишет в основном по-казахски, иначе ru.
article — артикул, если назван; model — название или описание модели словами клиента («чёрные зимние ботинки»), если из переписки понятно, о какой речь; size — размер числом («41»).
gender: m — мужская, w — женская, kids — детская, пусто — не сказано. season — сезон словом клиента («зима»). max_price — бюджет в тенге числом, 0 — не сказан.
city — город доставки; delivery — как хочет получить («Казпочта», «заберу в магазине», «курьер»); payment — как платит («Kaspi», «наличные»).
Пустая строка, если не сказано. Ничего не выдумывай.`;

/** Переписка одним текстом: так модель видит, кто что сказал, без требований к чередованию ролей. */
function transcript(history: ChatMessage[], question: string) {
  const lines = history.slice(-10).map((m) => `${m.role === 'user' ? 'Клиент' : 'Магазин'}: ${m.content.replace(/\s+/g, ' ').slice(0, 500)}`);
  return `${lines.length ? `Переписка:\n${lines.join('\n')}\n\n` : ''}Новое сообщение клиента: ${question.slice(0, 1500)}`;
}

const INTENTS = new Set<Intent>(['stock', 'pick', 'buy', 'info', 'other']);
const s = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && v ? String(v) : '');

export function parseUnderstanding(raw: string, fallback: string): Understanding | null {
  let cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  cleaned = cleaned.slice(start, end + 1);
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
  const intent = INTENTS.has(d.intent as Intent) ? (d.intent as Intent) : 'other';
  const gender = ['m', 'w', 'kids', 'uni'].includes(String(d.gender)) ? String(d.gender) : '';
  const price = Math.round(Number(d.max_price) || 0);
  return {
    query: s(d.query, 400) || fallback,
    intent,
    lang: d.lang === 'kk' ? 'kk' : 'ru',
    article: s(d.article, 40),
    model: s(d.model, 120),
    size: s(d.size, 8),
    gender,
    season: s(d.season, 30),
    color: s(d.color, 30),
    maxPrice: price > 0 ? price : null,
    city: s(d.city, 60),
    delivery: s(d.delivery, 60),
    payment: s(d.payment, 60),
  };
}

export async function understandMessage(ai: AIProvider, question: string, history: ChatMessage[]) {
  const result = await ai.generate({
    system: PROMPT,
    messages: [{ role: 'user', content: transcript(history, question) }],
    maxTokens: 400,
    temperature: 0,
  });
  return { understanding: parseUnderstanding(result.text, question), inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}
