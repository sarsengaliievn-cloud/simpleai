import type {
  WhatsAppProvider,
  OutboundTextMessage,
  OutboundTemplateMessage,
  SendResult,
  InboundMessage,
  StatusUpdate,
  PhoneNumberInfo,
  SendAuth,
} from './types.js';
import { WhatsAppSendError } from './types.js';
import { parseMetaWebhook, parseMetaStatuses } from './mock.js';
import { verifyMetaSignature } from './signature.js';

import { graphBase } from './graph.js';
import { downloadCloudMedia, type DownloadedMedia } from './media.js';

export { graphBase };

type GraphError = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
};

/**
 * Коды Meta, которые реально встречаются в работе, — в текст, понятный
 * менеджеру. Полный список: developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
function explain(status: number, body: GraphError): WhatsAppSendError {
  const code = String(body.error?.code ?? status);
  const sub = body.error?.error_subcode;
  const raw = `${body.error?.message ?? `HTTP ${status}`}${body.error?.error_data?.details ? ` — ${body.error.error_data.details}` : ''}`;

  const make = (userMessage: string, retryable = false, auth = false) =>
    new WhatsAppSendError(`Meta ${code}${sub ? `/${sub}` : ''}: ${raw}`, code, userMessage, retryable, auth);

  switch (code) {
    case '190':
      return make('Токен WhatsApp недействителен или истёк — переподключите номер в разделе «WhatsApp».', false, true);
    case '10':
    case '200':
      return make('У токена нет прав на этот номер WhatsApp — проверьте разрешения System User в Meta.', false, true);
    case '131047':
      return make('Прошло больше 24 часов с последнего сообщения клиента — Meta принимает только шаблон.');
    case '131026':
      return make('Сообщение не доставлено: у получателя нет WhatsApp или он не принял условия.');
    case '131030':
      return make('Номер не добавлен в список разрешённых получателей тестового номера Meta.');
    case '131031':
      return make('Аккаунт WhatsApp Business заблокирован или ограничен Meta.');
    case '133010':
      return make('Номер ещё не зарегистрирован в Cloud API — укажите PIN при подключении.');
    case '130429':
    case '131056':
    case '80007':
    case '4':
      return make('Meta временно ограничила частоту отправки — сообщение уйдёт при повторе.', true);
    case '131000':
    case '131016':
    case '2':
    case '1':
      return make('Временный сбой на стороне Meta — попробуйте ещё раз.', true);
    case '131051':
      return make('Тип сообщения не поддерживается.');
    case '132001':
      return make('Шаблон не найден или ещё не одобрен Meta.');
    case '100':
      return make(`Meta отклонила запрос: ${body.error?.message ?? 'неверный параметр'}.`);
    default:
      return make(`WhatsApp не принял сообщение (код ${code}).`, status >= 500);
  }
}

/**
 * Боевой провайдер: WhatsApp Business Platform (Cloud API) от Meta.
 * Официальный путь — номера клиентов не попадают под блокировки, как при
 * неофициальных веб-сессиях.
 */
export class CloudApiWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'cloud';

  private async call<T>(path: string, auth: SendAuth, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!auth.accessToken) {
      throw new WhatsAppSendError('нет токена', 'no_token', 'Номер WhatsApp не подключён или у него нет токена.', false, true);
    }

    let response: Response;
    try {
      response = await fetch(`${graphBase()}/${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new WhatsAppSendError(
        `сеть: ${(error as Error).message}`,
        'network',
        'Не удалось связаться с WhatsApp — попробуйте ещё раз.',
        true,
      );
    }

    const data = (await response.json().catch(() => ({}))) as T & GraphError;
    if (!response.ok || data.error) throw explain(response.status, data);
    return data;
  }

  async sendText(message: OutboundTextMessage): Promise<SendResult> {
    const data = await this.call<{ messages?: Array<{ id: string }> }>(`${message.phoneNumberId}/messages`, message, {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.to,
        type: 'text',
        text: { preview_url: false, body: message.text },
      },
    });
    const id = data.messages?.[0]?.id;
    if (!id) throw new WhatsAppSendError('нет id в ответе', 'no_id', 'WhatsApp не подтвердил отправку.', true);
    return { providerMessageId: id };
  }

  async sendTemplate(message: OutboundTemplateMessage): Promise<SendResult> {
    const data = await this.call<{ messages?: Array<{ id: string }> }>(`${message.phoneNumberId}/messages`, message, {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'template',
        template: {
          name: message.templateName,
          language: { code: message.languageCode },
          ...(message.variables?.length
            ? { components: [{ type: 'body', parameters: message.variables.map((text) => ({ type: 'text', text })) }] }
            : {}),
        },
      },
    });
    const id = data.messages?.[0]?.id;
    if (!id) throw new WhatsAppSendError('нет id в ответе', 'no_id', 'WhatsApp не подтвердил отправку.', true);
    return { providerMessageId: id };
  }

  /**
   * В боевом режиме без секрета приложения вебхук закрыт: лучше не принять
   * ничего, чем принимать поддельные «сообщения клиентов».
   */
  verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
      console.error('[whatsapp] META_APP_SECRET не задан — вебхук отклоняет все запросы');
      return false;
    }
    return verifyMetaSignature(rawBody, signatureHeader, secret);
  }

  parseWebhook(payload: unknown): InboundMessage[] {
    return parseMetaWebhook(payload);
  }

  parseStatuses(payload: unknown): StatusUpdate[] {
    return parseMetaStatuses(payload);
  }

  async markRead(input: SendAuth & { phoneNumberId: string; providerMessageId: string }) {
    try {
      await this.call(`${input.phoneNumberId}/messages`, input, {
        method: 'POST',
        body: { messaging_product: 'whatsapp', status: 'read', message_id: input.providerMessageId },
      });
    } catch (error) {
      console.warn('[whatsapp] не удалось отметить прочитанным:', (error as Error).message);
    }
  }

  async getPhoneNumber(input: SendAuth & { phoneNumberId: string }): Promise<PhoneNumberInfo> {
    const data = await this.call<{
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      messaging_limit_tier?: string;
    }>(`${input.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`, input);
    return {
      displayPhoneNumber: data.display_phone_number ?? input.phoneNumberId,
      verifiedName: data.verified_name ?? null,
      qualityRating: data.quality_rating ?? null,
      messagingLimit: data.messaging_limit_tier ?? null,
    };
  }

  async subscribeApp(input: SendAuth & { wabaId: string }) {
    await this.call(`${input.wabaId}/subscribed_apps`, input, { method: 'POST' });
  }

  async registerNumber(input: SendAuth & { phoneNumberId: string; pin: string }) {
    await this.call(`${input.phoneNumberId}/register`, input, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', pin: input.pin },
    });
  }

  async downloadMedia({ mediaId, accessToken }: { mediaId: string; accessToken: string | null }): Promise<DownloadedMedia> {
    if (!accessToken) throw new Error('Нет токена WhatsApp-аккаунта для скачивания файла');
    return downloadCloudMedia(mediaId, accessToken);
  }
}
