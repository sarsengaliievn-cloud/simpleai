import { MockWhatsAppProvider } from './mock.js';
import { CloudApiWhatsAppProvider } from './cloud.js';
import type { WhatsAppProvider } from './types.js';

let instance: WhatsAppProvider | null = null;

/**
 * WHATSAPP_PROVIDER:
 *   cloud — боевой WhatsApp Business Platform (Cloud API) от Meta;
 *   mock  — локальная разработка: наружу ничего не уходит.
 */
export function getProvider(): WhatsAppProvider {
  if (instance) return instance;

  const configured = (process.env.WHATSAPP_PROVIDER ?? 'mock').toLowerCase();
  switch (configured) {
    case 'cloud':
      instance = new CloudApiWhatsAppProvider();
      break;
    case 'mock':
      instance = new MockWhatsAppProvider();
      break;
    default:
      throw new Error(`Неизвестный WHATSAPP_PROVIDER=${configured}. Доступны: cloud, mock.`);
  }
  return instance;
}
