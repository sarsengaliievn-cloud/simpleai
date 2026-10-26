import type { TenantClient } from '@wa/db';
import { getProvider, WhatsAppSendError, type SendResult } from '@wa/whatsapp';
import { decryptSecret } from './crypto.js';

/**
 * Отправка от имени компании. Токен у каждой компании свой и лежит в базе
 * зашифрованным — расшифровываем только здесь, в момент отправки.
 */
async function resolveNumber(db: TenantClient, phoneNumberRowId: string) {
  const number = await db.whatsAppPhoneNumber.findFirst({
    where: { id: phoneNumberRowId },
    include: { account: true },
  });
  if (!number || number.status === 'DISCONNECTED') {
    throw new WhatsAppSendError('номер не найден или отключён', 'no_number', 'К диалогу не привязан активный номер WhatsApp.', false);
  }

  let accessToken: string | undefined;
  try {
    accessToken = decryptSecret(number.account.accessToken);
  } catch {
    // Демо-данные и мок хранят заглушку вместо токена. Cloud API без токена
    // откажет сам — с понятным текстом.
    accessToken = undefined;
  }
  return { number, accessToken };
}

/** Токен отозван или истёк: помечаем номер, чтобы это было видно в панели. */
async function flagAuthProblem(db: TenantClient, accountId: string, numberId: string) {
  await db.whatsAppAccount.updateMany({ where: { id: accountId }, data: { status: 'ERROR', lastCheckedAt: new Date() } });
  await db.whatsAppPhoneNumber.updateMany({ where: { id: numberId }, data: { status: 'ERROR' } });
}

export async function sendWhatsAppText(
  db: TenantClient,
  input: { phoneNumberRowId: string; to: string; text: string; retries?: number },
): Promise<SendResult> {
  const { number, accessToken } = await resolveNumber(db, input.phoneNumberRowId);
  const attempts = 1 + (input.retries ?? 0);

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await getProvider().sendText({
        phoneNumberId: number.phoneNumberId,
        to: input.to,
        text: input.text,
        accessToken,
      });
    } catch (error) {
      if (error instanceof WhatsAppSendError) {
        if (error.authProblem && error.code !== 'no_token') await flagAuthProblem(db, number.accountId, number.id);
        if (error.retryable && attempt < attempts) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
      }
      throw error;
    }
  }
}

/** Синие галочки у клиента. Ошибки не пробрасываются — это не критично. */
export async function markWhatsAppRead(db: TenantClient, input: { phoneNumberRowId: string; providerMessageId: string }) {
  try {
    const { number, accessToken } = await resolveNumber(db, input.phoneNumberRowId);
    await getProvider().markRead({ phoneNumberId: number.phoneNumberId, providerMessageId: input.providerMessageId, accessToken });
  } catch {
    /* номер отключён или нет токена — галочки просто не будет */
  }
}

/** Текст ошибки для человека: из WhatsAppSendError — готовый, иначе общий. */
export function sendErrorText(error: unknown): string {
  return error instanceof WhatsAppSendError ? error.userMessage : 'Не удалось отправить сообщение. Попробуйте ещё раз.';
}
