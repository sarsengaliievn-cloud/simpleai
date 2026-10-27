export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AIProvider {
  readonly name: string;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  embed(texts: string[]): Promise<number[][]>;
  /** Голосовое → текст. Аудио приходит из WhatsApp как есть (обычно audio/ogg; codecs=opus). */
  transcribe(audio: Buffer, mimeType: string): Promise<string>;
}

/** Общая инструкция для расшифровки: в Казахстане голосовые часто на смеси языков. */
export const TRANSCRIBE_PROMPT =
  'Расшифруй голосовое сообщение клиента дословно, на том языке, на котором он говорит ' +
  '(русский, казахский или их смесь). Не переводи, не отвечай на вопрос и не добавляй ' +
  'пояснений — верни только текст сказанного. Если речи не слышно, верни пустую строку.';

/** Голосовые WhatsApp не больше 16 МБ; inline-лимит Gemini — 20 МБ на весь запрос. */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
