import type { AIProvider, GenerateOptions, GenerateResult } from './provider.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

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
  ) {}

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
          maxOutputTokens: options.maxTokens ?? 1024,
          // Просим ответ сразу в JSON — наш разбор ждёт именно его.
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini вернул ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();

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
