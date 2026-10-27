import { getAI, getAIFor, type AIChoice } from './factory.js';

/** Расшифровка голосового ИИ компании (или сервера по умолчанию). */
export async function transcribeAudio(audio: Buffer, mimeType: string, choice?: AIChoice): Promise<string> {
  return (choice ? getAIFor(choice) : getAI()).transcribe(audio, mimeType);
}
