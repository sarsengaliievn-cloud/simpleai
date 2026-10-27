import { MAX_AUDIO_BYTES, TRANSCRIBE_PROMPT, type AIProvider, type GenerateOptions, type GenerateResult } from './provider.js';

const API = 'https://api.anthropic.com/v1/messages';
const EMBED_API = 'https://api.openai.com/v1/embeddings';
const TRANSCRIBE_API = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Генерация — Anthropic, эмбеддинги — OpenAI: у Anthropic своего эмбеддера нет.
 * Размерность 1536 совпадает с колонкой vector(1536); при смене модели
 * эмбеддингов колонку и все чанки придётся пересоздать.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? '',
    private readonly embedKey = process.env.OPENAI_API_KEY ?? '',
    private readonly model = process.env.AI_MODEL ?? 'claude-sonnet-4-6',
  ) {}

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY не задан');

    const response = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.3,
        system: options.system,
        messages: options.messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic вернул ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    return {
      text: data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim(),
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.embedKey) throw new Error('OPENAI_API_KEY не задан (нужен для эмбеддингов)');

    const response = await fetch(EMBED_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.embedKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    });

    if (!response.ok) {
      throw new Error(`Эмбеддинги вернули ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  /** Anthropic аудио не принимает — расшифровку делает OpenAI тем же ключом, что и эмбеддинги. */
  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    if (!this.embedKey) throw new Error('OPENAI_API_KEY не задан (нужен для расшифровки голосовых)');
    if (audio.length > MAX_AUDIO_BYTES) throw new Error('Голосовое слишком большое для расшифровки');

    const type = mimeType.split(';')[0]!.trim() || 'audio/ogg';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type }), `voice.${type.split('/')[1] ?? 'ogg'}`);
    form.append('model', process.env.AI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
    form.append('prompt', TRANSCRIBE_PROMPT);

    const response = await fetch(TRANSCRIBE_API, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.embedKey}` },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Расшифровка вернула ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const data = (await response.json()) as { text?: string };
    return (data.text ?? '').trim();
  }
}
