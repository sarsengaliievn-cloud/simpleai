import { getAI } from './factory.js';

/** Расшифровка голосового текущим AI-провайдером (AI_PROVIDER). */
export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<string> {
  return getAI().transcribe(audio, mimeType);
}
