import { searchChunks, type SearchHit } from '@wa/db';
import { getAIFor, resolveAI, type AIChoice } from './factory.js';
import { estimateTokens } from './chunk.js';
import { buildSystemPrompt, type AIConfigLike } from './prompt.js';
import type { ChatMessage } from './provider.js';

export type AnswerResult = {
  answer: string;
  /** Итоговая уверенность 0..100 после проверки по найденным фрагментам. */
  confidence: number;
  modelConfidence: number;
  topScore: number;
  needsHuman: boolean;
  hits: SearchHit[];
  /** Расход для баланса: генерация и эмбеддинг вопроса. */
  usage: { inputTokens: number; outputTokens: number; embedTokens: number };
  /** Каким ИИ отвечали — для списания по цене модели. */
  ai: AIChoice;
};

/** Ниже этого совпадения считаем, что в базе знаний ответа просто нет. */
const MIN_RELEVANCE = 0.35;

/*
 * Приветствие и «спасибо» в базе знаний не ищем: ответа там нет, и раньше
 * бот на «Здравствуйте» звал менеджера. Признаём такую реплику, только если
 * в ней есть приветствие или благодарность и кроме них ничего — «да» или
 * «ок» в ответ на вопрос бота сюда не попадут.
 */
const SMALLTALK_CORE = new Set([
  'привет', 'приветствую', 'здравствуйте', 'здравствуй', 'здрасте', 'здрасьте', 'добрый', 'доброе', 'доброй',
  'салем', 'сәлем', 'салам', 'сәлеметсіз', 'сәлеметсізбе', 'салеметсиз', 'салеметсизбе', 'саламатсызба',
  'ассаляму', 'ассалям', 'ассалам', 'ассаламу', 'алейкум', 'алейкуму', 'уалейкум', 'қайырлы', 'кайырлы',
  'hi', 'hello', 'hey', 'спасибо', 'спс', 'благодарю', 'рахмет', 'рақмет', 'thanks', 'thank',
  'дела', 'қалайсыз', 'калайсыз', 'қалай', 'калай', 'жағдай', 'жагдай',
]);
const SMALLTALK_EXTRA = new Set([
  'день', 'вечер', 'утро', 'ночи', 'таң', 'кеш', 'күн', 'тан', 'кун', 'как', 'ваши', 'у', 'вас', 'вам', 'большое',
  'огромное', 'you', 'very', 'much', 'ок', 'окей', 'ok', 'хорошо', 'понятно', 'ясно', 'отлично', 'супер', 'ладно',
  'пожалуйста', 'и', 'еще', 'ещё', 'всё', 'все', 'норм', 'класс', 'круто', 'жақсы', 'жаксы', 'көп', 'коп', 'бе', 'ба', 'ме', 'ма',
]);

export function isSmallTalk(text: string): boolean {
  const words = text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}]+/gu) ?? [];
  if (words.length === 0 || words.length > 8) return false;
  const core = (w: string) => SMALLTALK_CORE.has(w) || SMALLTALK_CORE.has(w.replace(/е/g, 'ё'));
  const extra = (w: string) => SMALLTALK_EXTRA.has(w) || SMALLTALK_EXTRA.has(w.replace(/е/g, 'ё'));
  return words.some(core) && words.every((w) => core(w) || extra(w));
}

const SMALLTALK_NOTE =
  'Фрагментов базы знаний для этого сообщения нет: клиент просто здоровается или благодарит. ' +
  'Ответь коротко и тепло на его языке: поздоровайся или ответь на благодарность и спроси, чем можешь помочь. ' +
  'Ничего не говори о товарах, ценах, наличии и доставке. Верни confidence 100 и needs_human = false.';

export async function answerQuestion(params: {
  companyId: string;
  company: { name: string; description?: string | null; city?: string | null };
  config: AIConfigLike & { confidenceThreshold: number; aiProvider?: string | null; aiModel?: string | null };
  question: string;
  history?: ChatMessage[];
}): Promise<AnswerResult> {
  const choice = resolveAI(params.config);
  const ai = getAIFor(choice);

  if (isSmallTalk(params.question)) {
    const result = await ai.generate({
      system: buildSystemPrompt(params.config, params.company),
      messages: normalizeHistory([
        ...(params.history ?? []),
        { role: 'user', content: `${SMALLTALK_NOTE}\n\nСообщение клиента: ${params.question}` },
      ]),
    });
    const parsed = parseAnswer(result.text);
    return {
      answer: parsed.answer,
      confidence: parsed.answer ? parsed.confidence : 0,
      modelConfidence: parsed.confidence,
      topScore: 0,
      needsHuman: !parsed.answer || parsed.needsHuman,
      hits: [],
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, embedTokens: 0 },
      ai: choice,
    };
  }

  const embedTokens = estimateTokens(params.question);

  const [embedding] = await ai.embed([params.question]);
  const hits = embedding ? await searchChunks(params.companyId, embedding, 5) : [];
  const relevant = hits.filter((h) => h.score >= MIN_RELEVANCE);
  const topScore = relevant[0]?.score ?? 0;

  // База молчит — до модели даже не идём: дешевле и честнее.
  if (relevant.length === 0) {
    return {
      answer: '',
      confidence: 0,
      modelConfidence: 0,
      topScore,
      needsHuman: true,
      hits,
      usage: { inputTokens: 0, outputTokens: 0, embedTokens },
      ai: choice,
    };
  }

  const context = relevant
    .map((h, i) => `[${i + 1}] Источник: ${h.documentTitle}\n${h.content}`)
    .join('\n\n---\n\n');

  const result = await ai.generate({
    system: buildSystemPrompt(params.config, params.company),
    messages: normalizeHistory([
      ...(params.history ?? []),
      { role: 'user', content: `Фрагменты базы знаний:\n\n${context}\n\n---\n\nВопрос клиента: ${params.question}` },
    ]),
  });

  const parsed = parseAnswer(result.text);

  // Модель склонна завышать уверенность в себе, поэтому итог ограничиваем
  // качеством найденных фрагментов: нет опоры в базе — нет высокой оценки.
  const confidence = Math.min(parsed.confidence, Math.round(topScore * 100));

  return {
    answer: parsed.answer,
    confidence,
    modelConfidence: parsed.confidence,
    topScore,
    needsHuman: parsed.needsHuman || confidence < params.config.confidenceThreshold,
    hits,
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, embedTokens },
    ai: choice,
  };
}

/**
 * Провайдеры капризны к форме истории: Anthropic требует, чтобы диалог
 * начинался с user и роли чередовались. В переписке так бывает не всегда
 * (ассистент написал первым, клиент прислал три сообщения подряд), поэтому
 * ведущие ответы ассистента отбрасываем, а подряд идущие реплики одной
 * стороны склеиваем.
 */
export function normalizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const content = m.content.trim().slice(0, 4000);
    if (!content) continue;
    if (out.length === 0 && m.role !== 'user') continue;
    const prev = out.at(-1);
    if (prev && prev.role === m.role) prev.content += `\n${content}`;
    else out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return out;
}

function parseAnswer(raw: string): { answer: string; confidence: number; needsHuman: boolean } {
  let cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  // Модель иногда добавляет фразу до или после JSON — берём сам объект.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);

  try {
    const data = JSON.parse(cleaned) as { answer?: string; confidence?: number; needs_human?: boolean };
    return {
      answer: (data.answer ?? '').trim(),
      confidence: Math.max(0, Math.min(100, Number(data.confidence ?? 0))),
      needsHuman: Boolean(data.needs_human),
    };
  } catch {
    // Модель ответила не JSON — считаем это сбоем и зовём человека,
    // а не отправляем клиенту сырой текст неизвестного качества.
    return { answer: '', confidence: 0, needsHuman: true };
  }
}
