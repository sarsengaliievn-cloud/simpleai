import { prisma } from '@wa/db';
import { getProvider } from '@wa/whatsapp';
import { inboundMessageQueue } from '@/lib/queue';

export const dynamic = 'force-dynamic';

/** Подтверждение вебхука со стороны Meta. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

/**
 * Приём событий. Здесь нельзя делать ничего долгого: Meta ждёт 200 за
 * секунды и повторяет доставку при таймауте. Проверили подпись, положили
 * в очередь, ответили. Всё остальное — работа воркера.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  if (!getProvider().verifySignature(raw, request.headers.get('x-hub-signature-256'))) {
    return new Response('invalid signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const messages = getProvider().parseWebhook(payload);
  if (messages.length === 0) return new Response('ok', { status: 200 });

  // Ключ дедупликации: Meta может прислать одно событие несколько раз.
  const externalId = messages[0]!.providerMessageId;

  try {
    const event = await prisma.webhookEvent.create({
      data: { externalId, payload: payload as never },
    });
    await inboundMessageQueue.add(
      'inbound',
      { webhookEventId: event.id },
      { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000 },
    );
  } catch (error) {
    // Уникальный индекс по externalId — повторная доставка того же события.
    if ((error as { code?: string }).code !== 'P2002') {
      console.error('[webhook] ошибка приёма:', error);
    }
  }

  return new Response('ok', { status: 200 });
}
