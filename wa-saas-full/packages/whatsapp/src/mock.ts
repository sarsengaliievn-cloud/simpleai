import type {
  WhatsAppProvider,
  OutboundTextMessage,
  OutboundTemplateMessage,
  SendResult,
  InboundMessage,
  StatusUpdate,
  PhoneNumberInfo,
  EchoMessage,
} from './types.js';
import { verifyMetaSignature } from './signature.js';
import { downloadCloudMedia, MAX_MEDIA_BYTES, type DownloadedMedia } from './media.js';

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

  parseStatuses(payload: unknown): StatusUpdate[] {
    return parseMetaStatuses(payload);
  }

  parseEchoes(payload: unknown): EchoMessage[] {
    return parseMetaEchoes(payload);
  }

  async markRead() {}

  async getPhoneNumber(input: { phoneNumberId: string }): Promise<PhoneNumberInfo> {
    return { displayPhoneNumber: input.phoneNumberId, verifiedName: null, qualityRating: null, messagingLimit: null };
  }

  async subscribeApp() {}

  async registerNumber() {}

  /**
   * Для проверки голосовых без боевого номера: в тестовом вебхуке вместо
   * media id можно указать ссылку на .ogg/.mp3 — мок скачает её. Только вне
   * production: иначе любой, кто шлёт вебхуки, заставил бы сервер ходить
   * по произвольным адресам. Настоящий media id идёт в Cloud API как обычно.
   */
  async downloadMedia({ mediaId, accessToken }: { mediaId: string; accessToken: string | null }): Promise<DownloadedMedia> {
    if (/^https?:\/\//.test(mediaId)) {
      if (process.env.NODE_ENV === 'production') throw new Error('Ссылки вместо media id запрещены в production');
      const response = await fetch(mediaId);
      if (!response.ok) throw new Error(`Тестовый файл: ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > MAX_MEDIA_BYTES) throw new Error('Файл больше 16 МБ');
      return { data, mimeType: response.headers.get('content-type') ?? 'audio/ogg' };
    }
    if (!accessToken) throw new Error('Нет токена WhatsApp-аккаунта для скачивания файла');
    return downloadCloudMedia(mediaId, accessToken);
  }
}

/** Время Meta — секунды строкой. Битое значение не должно ронять запись в базу. */
function metaTime(value: unknown): Date {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

export function parseMetaStatuses(payload: unknown): StatusUpdate[] {
  const result: StatusUpdate[] = [];
  const body = payload as any;
  const allowed = new Set(['sent', 'delivered', 'read', 'failed']);

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      for (const s of value?.statuses ?? []) {
        if (!s?.id || !allowed.has(s.status)) continue;
        result.push({
          providerMessageId: s.id,
          phoneNumberId,
          status: s.status,
          timestamp: metaTime(s.timestamp),
          errorCode: s.errors?.[0]?.code !== undefined ? String(s.errors[0].code) : undefined,
          errorTitle: s.errors?.[0]?.title ?? s.errors?.[0]?.message,
        });
      }
    }
  }

  return result;
}

export function parseMetaWebhook(payload: unknown): InboundMessage[] {
  const result: InboundMessage[] = [];
  const body = payload as any;

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Имена приходят списком contacts — сопоставляем по номеру, а не берём
      // первое: в одной пачке могут быть сообщения от разных клиентов.
      const names = new Map<string, string>();
      for (const c of value?.contacts ?? []) {
        if (c?.wa_id && c?.profile?.name) names.set(String(c.wa_id), String(c.profile.name));
      }
      const fallbackName: string | undefined = value?.contacts?.[0]?.profile?.name;

      for (const message of value?.messages ?? []) {
        if (!message?.id || !message?.from) continue;
        result.push({
          providerMessageId: message.id,
          phoneNumberId,
          from: message.from,
          profileName: names.get(String(message.from)) ?? (names.size === 0 ? fallbackName : undefined),
          ...messageContent(message),
          timestamp: metaTime(message.timestamp),
        });
      }
    }
  }

  return result;
}

/** Тип, текст и вложение — одинаково для входящих и для ответов с телефона. */
function messageContent(message: any): Pick<InboundMessage, 'type' | 'text' | 'mediaId' | 'mediaMimeType'> {
  const type = message.type as string;
  // Нажатие кнопки шаблона и выбор из списка — для ассистента это
  // обычный текстовый ответ клиента.
  const replyText: string | undefined =
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title;

  return {
    type: replyText
      ? 'text'
      : ['text', 'image', 'audio', 'video', 'document', 'location'].includes(type)
        ? (type as InboundMessage['type'])
        : 'unsupported',
    // Подпись к фото/документу Meta кладёт внутрь image/document, а не в корень.
    text: message.text?.body ?? replyText ?? message[type]?.caption,
    mediaId: message[type]?.id,
    mediaMimeType: message[type]?.mime_type,
  };
}

/**
 * Ответы менеджера из приложения WhatsApp Business (Coexistence):
 * change.field = "smb_message_echoes", value.message_echoes[].
 */
export function parseMetaEchoes(payload: unknown): EchoMessage[] {
  const result: EchoMessage[] = [];
  const body = payload as any;

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      for (const message of value?.message_echoes ?? []) {
        if (!message?.id || !message?.to) continue;
        result.push({
          providerMessageId: message.id,
          phoneNumberId,
          to: String(message.to),
          ...messageContent(message),
          timestamp: metaTime(message.timestamp),
        });
      }
    }
  }

  return result;
}
