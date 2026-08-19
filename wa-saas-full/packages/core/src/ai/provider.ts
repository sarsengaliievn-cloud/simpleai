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
}
