import type {
  WhatsAppProvider,
  OutboundTextMessage,
  OutboundTemplateMessage,
  SendResult,
  InboundMessage,
} from './types.js';
import { verifyMetaSignature } from './signature.js';

/**
 * Мок для разработки: наружу ничего не отправляет, пишет в консоль.
 * Формат входящего payload намеренно повторяет Meta, чтобы парсер не пришлось
 * переписывать при переходе на боевой Cloud API.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'mock';
  public readonly sent: Array<OutboundTextMessage | OutboundTemplateMessage> = [];

  async sendText(message: OutboundTextMessage): Promise<SendResult> {
    this.sent.push(message);
    console.log(`[mock-whatsapp] -> ${message.to}: ${message.text}`);
    return { providerMessageId: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  }

  async sendTemplate(message: OutboundTemplateMessage): Promise<SendResult> {
    this.sent.push(message);
    console.log(`[mock-whatsapp] -> ${message.to}: template ${message.templateName}`);
    return { providerMessageId: `mock_tpl_${Date.now()}` };
  }

  /**
   * Пока META_APP_SECRET не задан (локальная разработка, curl из README) —
   * пропускаем. Как только секрет есть, подпись проверяется по-настоящему,
   * даже с мок-провайдером: на сервере вебхук открыт всему интернету.
   */
  verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) return true;
    return verifyMetaSignature(rawBody, signatureHeader, secret);
  }

  parseWebhook(payload: unknown): InboundMessage[] {
    return parseMetaWebhook(payload);
  }
}

export function parseMetaWebhook(payload: unknown): InboundMessage[] {
  const result: InboundMessage[] = [];
  const body = payload as any;

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const profileName = value?.contacts?.[0]?.profile?.name;

      for (const message of value?.messages ?? []) {
        if (!message?.id || !message?.from) continue;
        const type = message.type as string;

        // Нажатие кнопки шаблона и выбор из списка — для ассистента это
        // обычный текстовый ответ клиента.
        const replyText: string | undefined =
          message.button?.text ??
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title;

        result.push({
          providerMessageId: message.id,
          phoneNumberId,
          from: message.from,
          profileName,
          type: replyText
            ? 'text'
            : ['text', 'image', 'audio', 'video', 'document', 'location'].includes(type)
              ? (type as InboundMessage['type'])
              : 'unsupported',
          // Подпись к фото/документу Meta кладёт внутрь image/document, а не в корень.
          text: message.text?.body ?? replyText ?? message[type]?.caption,
          mediaId: message[type]?.id,
          mediaMimeType: message[type]?.mime_type,
          timestamp: new Date(Number(message.timestamp) * 1000),
        });
      }
    }
  }

  return result;
}
