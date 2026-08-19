import { searchChunks, type SearchHit } from '@wa/db';
import { getAI } from './factory.js';
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
  usage: { inputTokens: number; outputTokens: number };
};

/** Ниже этого совпадения считаем, что в базе знаний ответа просто нет. */
const MIN_RELEVANCE = 0.35;

export async function answerQuestion(params: {
  companyId: string;
  company: { name: string; description?: string | null; city?: string | null };
  config: AIConfigLike & { confidenceThreshold: number };
  question: string;
  history?: ChatMessage[];
}): Promise<AnswerResult> {
  const ai = getAI();

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
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const context = relevant
    .map((h, i) => `[${i + 1}] Источник: ${h.documentTitle}\n${h.content}`)
    .join('\n\n---\n\n');

  const result = await ai.generate({
    system: buildSystemPrompt(params.config, params.company),
    messages: [
      ...(params.history ?? []),
      { role: 'user', content: `Фрагменты базы знаний:\n\n${context}\n\n---\n\nВопрос клиента: ${params.question}` },
    ],
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
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
  };
}

function parseAnswer(raw: string): { answer: string; confidence: number; needsHuman: boolean } {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

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
