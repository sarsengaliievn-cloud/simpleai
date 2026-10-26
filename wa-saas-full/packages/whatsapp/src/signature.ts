import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка заголовка X-Hub-Signature-256: HMAC-SHA256 тела запроса
 * секретом приложения Meta. Без неё любой, кто знает адрес вебхука,
 * может подсунуть «входящее сообщение» и заставить ассистента отвечать
 * за счёт вашего AI-ключа.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  let received: Buffer;
  try {
    received = Buffer.from(header.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }

  return received.length === expected.length && timingSafeEqual(received, expected);
}
