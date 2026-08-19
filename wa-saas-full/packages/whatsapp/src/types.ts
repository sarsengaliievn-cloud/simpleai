export interface OutboundTextMessage {
  phoneNumberId: string;
  to: string;
  text: string;
}

export interface OutboundTemplateMessage {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string;
  variables?: string[];
}

export interface SendResult {
  providerMessageId: string;
}

export interface InboundMessage {
  providerMessageId: string;
  phoneNumberId: string;
  from: string;
  profileName?: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'unsupported';
  text?: string;
  mediaId?: string;
  mediaMimeType?: string;
  timestamp: Date;
}

/**
 * Единственная точка соприкосновения с WhatsApp. Мок и Cloud API реализуют
 * один интерфейс — переключение делается переменной окружения, а не правкой
 * бизнес-логики.
 */
export interface WhatsAppProvider {
  readonly name: string;
  sendText(message: OutboundTextMessage): Promise<SendResult>;
  sendTemplate(message: OutboundTemplateMessage): Promise<SendResult>;
  verifySignature(rawBody: string, signatureHeader: string | null): boolean;
  parseWebhook(payload: unknown): InboundMessage[];
}
