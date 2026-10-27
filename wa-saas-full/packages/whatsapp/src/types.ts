/**
 * Токен доступа — свой у каждой компании (её WhatsApp Business Account).
 * Мок его игнорирует, Cloud API без него не отправит ни одного сообщения.
 */
export interface SendAuth {
  accessToken?: string;
}

export interface OutboundTextMessage extends SendAuth {
  phoneNumberId: string;
  to: string;
  text: string;
}

export interface OutboundTemplateMessage extends SendAuth {
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
 * Сообщение, которое менеджер отправил клиенту сам — из приложения
 * WhatsApp Business на телефоне (режим Coexistence). Meta присылает его
 * копию событием smb_message_echoes.
 */
export interface EchoMessage {
  providerMessageId: string;
  phoneNumberId: string;
  /** Номер клиента. */
  to: string;
  type: InboundMessage['type'];
  text?: string;
  mediaId?: string;
  mediaMimeType?: string;
  timestamp: Date;
}

/** Статус ранее отправленного нами сообщения: sent → delivered → read, или failed. */
export interface StatusUpdate {
  providerMessageId: string;
  phoneNumberId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
  errorCode?: string;
  errorTitle?: string;
}

/** Номер в Meta, как его видит Cloud API. */
export interface PhoneNumberInfo {
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  messagingLimit: string | null;
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
  parseStatuses(payload: unknown): StatusUpdate[];
  /** Ответы менеджера с телефона (Coexistence). */
  parseEchoes(payload: unknown): EchoMessage[];
  /** Синие галочки у клиента. Не критично: сбой только пишется в лог. */
  markRead(input: SendAuth & { phoneNumberId: string; providerMessageId: string }): Promise<void>;
  /** Проверка токена и номера при подключении. */
  getPhoneNumber(input: SendAuth & { phoneNumberId: string }): Promise<PhoneNumberInfo>;
  /** Подписка нашего приложения на вебхуки WABA — без неё входящие не придут. */
  subscribeApp(input: SendAuth & { wabaId: string }): Promise<void>;
  /** Регистрация номера в Cloud API (PIN двухэтапной проверки). */
  registerNumber(input: SendAuth & { phoneNumberId: string; pin: string }): Promise<void>;
  /** Вложение из входящего сообщения (голосовое, фото). Токен — WABA компании. */
  downloadMedia(params: { mediaId: string; accessToken: string | null }): Promise<{ data: Buffer; mimeType: string }>;
}

/**
 * Ошибка Meta, разобранная до понятного менеджеру текста. `retryable` —
 * имеет ли смысл повторить позже (лимиты, сбой на стороне Meta).
 */
export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userMessage: string,
    public readonly retryable: boolean,
    /** Токен недействителен — компании нужно переподключить номер. */
    public readonly authProblem = false,
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}
