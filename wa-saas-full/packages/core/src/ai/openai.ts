import { MAX_AUDIO_BYTES, TRANSCRIBE_PROMPT, type AIProvider, type GenerateOptions, type GenerateResult } from './provider.js';

/** Переопределяется через OPENAI_BASE_URL — для прокси или тестового стенда. */
export function openaiBase() {
  return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
}

/**
 * Модель ChatGPT: OPENAI_MODEL, иначе AI_MODEL — если это модель OpenAI
 * (после перехода с Gemini в AI_MODEL может остаться gemini-…).
 */
export function openaiModel() {
  const generic = process.env.AI_MODEL ?? '';
  return process.env.OPENAI_MODEL || (/^(gpt|o\d|chatgpt)/i.test(generic) ? generic : 'gpt-5-mini');
}

/** Эмбеддинги OpenAI: 1536 измерений — ровно под колонку vector(1536). */
export const OPENAI_EMBED_MODEL = 'text-embedding-3-small';

export async function openaiEmbed(apiKey: string, texts: string[]): Promise<number[][]> {
  if (!apiKey) throw new Error('OPENAI_API_KEY не задан (нужен для эмбеддингов)');

  const response = await fetch(`${openaiBase()}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: texts }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI (эмбеддинги) вернул ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function openaiTranscribe(apiKey: string, audio: Buffer, mimeType: string): Promise<string> {
  if (!apiKey) throw new Error('OPENAI_API_KEY не задан (нужен для расшифровки голосовых)');
  if (audio.length > MAX_AUDIO_BYTES) throw new Error('Голосовое слишком большое для расшифровки');

  const type = mimeType.split(';')[0]!.trim() || 'audio/ogg';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type }), `voice.${type.split('/')[1] ?? 'ogg'}`);
  const custom = process.env.AI_TRANSCRIBE_MODEL ?? '';
  form.append('model', /transcribe|whisper/i.test(custom) ? custom : 'gpt-4o-mini-transcribe');
  form.append('prompt', TRANSCRIBE_PROMPT);

  const response = await fetch(`${openaiBase()}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`OpenAI (расшифровка) вернул ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').trim();
}

type ResponsesPayload = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/**
 * Текст ответа из Responses API. Рассуждения модели (type: reasoning)
 * пропускаем — нужен только итоговый ответ.
 */
export function responsesText(data: ResponsesPayload): string {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text.trim();
  return (data.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();
}

/**
 * ChatGPT (OpenAI). Генерация — через Responses API: он поддерживает и новые
 * модели, и «думающие». Температуру не передаём — думающие модели её не
 * принимают. Эмбеддинги и голосовые — тем же ключом.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY ?? '',
    private readonly model = openaiModel(),
  ) {}

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY не задан');

    const response = await fetch(`${openaiBase()}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        instructions: options.system,
        input: options.messages.map((m) => ({ role: m.role, content: m.content })),
        // У думающих моделей рассуждения расходуют тот же лимит, что и ответ —
        // с маленьким лимитом JSON обрезался бы на середине.
        max_output_tokens: Math.max(options.maxTokens ?? 0, 8192),
        // Ответ сразу JSON — наш разбор ждёт именно его.
        text: { format: { type: 'json_object' } },
        ...(process.env.AI_REASONING_EFFORT ? { reasoning: { effort: process.env.AI_REASONING_EFFORT } } : {}),
        store: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI вернул ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = (await response.json()) as ResponsesPayload;
    const text = responsesText(data);
    if (!text || data.status === 'incomplete') {
      console.warn(`[openai] ответ ${text ? 'неполный' : 'пустой'}: status=${data.status ?? '—'}, reason=${data.incomplete_details?.reason ?? '—'}`);
    }

    return {
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }

  embed(texts: string[]): Promise<number[][]> {
    return openaiEmbed(this.apiKey, texts);
  }

  transcribe(audio: Buffer, mimeType: string): Promise<string> {
    return openaiTranscribe(this.apiKey, audio, mimeType);
  }
}
