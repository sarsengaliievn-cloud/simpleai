import { MockWhatsAppProvider } from './mock.js';
import type { WhatsAppProvider } from './types.js';

let instance: WhatsAppProvider | null = null;

/**
 * Спринт 6: сюда добавляется CloudApiWhatsAppProvider и выбор по
 * WHATSAPP_PROVIDER=cloud. До тех пор честно работает только мок —
 * никакой имитации боевого подключения.
 */
export function getProvider(): WhatsAppProvider {
  if (instance) return instance;

  const configured = process.env.WHATSAPP_PROVIDER ?? 'mock';
  if (configured !== 'mock') {
    throw new Error(
      `WHATSAPP_PROVIDER=${configured} ещё не реализован. Доступен только mock (спринт 6).`,
    );
  }

  instance = new MockWhatsAppProvider();
  return instance;
}
