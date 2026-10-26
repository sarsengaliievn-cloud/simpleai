import { createHash } from 'node:crypto';
import { prisma } from '@wa/db';
import { getProvider } from '@wa/whatsapp';
import { inboundMessageQueue, JOB_CLEANUP } from '@/lib/queue';

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

async function enqueue(eventId: string, retry = false) {
  // jobId = id события: даже если Meta пришлёт дубль в ту же секунду,
  // BullMQ не поставит вторую задачу. Для повтора упавшего события id
  // другой — старая задача ещё лежит в списке упавших и заняла бы его.
  await inboundMessageQueue.add(
    'inbound',
    { webhookEventId: eventId },
    {
      jobId: retry ? `${eventId}-retry-${Date.now()}` : eventId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      ...JOB_CLEANUP,
    },
  );
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

  // В одном вебхуке могут быть и сообщения клиентов, и статусы наших
  // сообщений (отправлено / доставлено / прочитано). Обработка — в воркере.
  const provider = getProvider();
  const messages = provider.parseWebhook(payload);
  const statuses = provider.parseStatuses(payload);
  if (messages.length === 0 && statuses.length === 0) return new Response('ok', { status: 200 });

  // Ключ дедупликации: Meta может прислать одно событие несколько раз.
  // У статуса ключ — id сообщения + сам статус: «доставлено» и «прочитано»
  // по одному сообщению — разные события.
  const keys = [
    ...messages.map((m) => m.providerMessageId),
    ...statuses.map((st) => `${st.providerMessageId}:${st.status}`),
  ].sort().join('|');
  const externalId = keys.length <= 200 ? keys : `sha256:${createHash('sha256').update(keys).digest('hex')}`;

  try {
    const event = await prisma.webhookEvent.create({
      data: { externalId, payload: payload as never },
    });
    await enqueue(event.id);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      // Повторная доставка. Если в прошлый раз событие записали, но в
      // очередь не положили (упал Redis) — даём ему второй шанс, иначе
      // сообщение клиента потерялось бы навсегда.
      const existing = await prisma.webhookEvent.findUnique({ where: { externalId } });
      if (existing && (existing.status === 'RECEIVED' || existing.status === 'FAILED')) {
        await enqueue(existing.id, existing.status === 'FAILED').catch((e) => console.error('[webhook] повторная постановка не удалась:', e));
      }
    } else {
      console.error('[webhook] ошибка приёма:', error);
      // 500 — Meta повторит доставку позже, событие не потеряется.
      return new Response('temporary error', { status: 500 });
    }
  }

  return new Response('ok', { status: 200 });
}
