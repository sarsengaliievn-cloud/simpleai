import type { AIProvider, GenerateOptions, GenerateResult } from './provider.js';
import { openaiEmbed, openaiTranscribe } from './openai.js';

const API = 'https://api.anthropic.com/v1/messages';

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

  embed(texts: string[]): Promise<number[][]> {
    return openaiEmbed(this.embedKey, texts);
  }

  /** Anthropic аудио не принимает — расшифровку делает OpenAI тем же ключом, что и эмбеддинги. */
  transcribe(audio: Buffer, mimeType: string): Promise<string> {
    return openaiTranscribe(this.embedKey, audio, mimeType);
  }
}
