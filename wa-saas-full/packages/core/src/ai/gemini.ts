import { MAX_AUDIO_BYTES, TRANSCRIBE_PROMPT, type AIProvider, type GenerateOptions, type GenerateResult } from './provider.js';

/** Переопределяется через GEMINI_BASE_URL — для прокси или тестового стенда. */
const BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

/** Размерность должна совпадать с колонкой vector(1536) в knowledge_chunks. */
const EMBED_DIM = 1536;

/**
 * Google Gemini: один ключ на генерацию и эмбеддинги.
 * Роли у Gemini называются иначе — assistant здесь model.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY ?? '',
    private readonly model = process.env.AI_MODEL ?? 'gemini-2.5-flash',
    private readonly embedModel = process.env.AI_EMBED_MODEL ?? 'gemini-embedding-001',
    /** Расшифровка — та же модель, если не задана отдельная. */
    private readonly transcribeModel = process.env.AI_TRANSCRIBE_MODEL || process.env.AI_MODEL || 'gemini-2.5-flash',
  ) {}

  /** Gemini слушает аудио сам: отдельный сервис распознавания речи не нужен. */
  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY не задан');
    if (audio.length > MAX_AUDIO_BYTES) throw new Error('Голосовое слишком большое для расшифровки');

    const response = await fetch(`${BASE}/models/${this.transcribeModel}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            // «audio/ogg; codecs=opus» → «audio/ogg»: параметры кодека Gemini не принимает.
            { inline_data: { mime_type: mimeType.split(';')[0]!.trim() || 'audio/ogg', data: audio.toString('base64') } },
            { text: TRANSCRIBE_PROMPT },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini (расшифровка) вернул ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };
    return (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
      .trim();
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY не задан');

    const response = await fetch(`${BASE}/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: options.system }] },
        contents: options.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: options.temperature ?? 0.3,
          // У «думающих» моделей Gemini (2.5+, 3.x) рассуждения расходуют
          // тот же лимит, что и ответ. При 1024 JSON обрезался на середине,
          // разбор падал, и ассистент звал менеджера на простой вопрос.
          maxOutputTokens: Math.max(options.maxTokens ?? 0, 8192),
          // Просим ответ сразу в JSON — наш разбор ждёт именно его.
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini вернул ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
      .trim();

    // Пустой или обрезанный ответ — повод для менеджера, но причину пишем
    // в лог, иначе «ассистент всё время зовёт человека» не разобрать.
    if (!text || (candidate?.finishReason && candidate.finishReason !== 'STOP')) {
      console.warn(
        `[gemini] ответ ${text ? 'неполный' : 'пустой'}: finishReason=${candidate?.finishReason ?? '—'}` +
          (data.promptFeedback?.blockReason ? `, blockReason=${data.promptFeedback.blockReason}` : ''),
      );
    }

    return {
      text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY не задан');

    const response = await fetch(`${BASE}/models/${this.embedModel}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.embedModel}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBED_DIM,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini embeddings вернул ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = (await response.json()) as { embeddings?: Array<{ values: number[] }> };
    const vectors = (data.embeddings ?? []).map((e) => e.values);

    if (vectors.length !== texts.length) {
      throw new Error(`Ожидали ${texts.length} векторов, получили ${vectors.length}`);
    }

    // При урезанной размерности Gemini не нормализует вектор сам,
    // а косинусное расстояние в pgvector ждёт единичную длину.
    return vectors.map(normalize);
  }
}

function normalize(vector: number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return length ? vector.map((v) => v / length) : vector;
}
