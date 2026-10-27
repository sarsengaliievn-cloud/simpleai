import { Queue } from 'bullmq';
import { QUEUES, type AiReplyJob } from '@wa/core';
import { connection } from './redis.js';

/** Воркер сам ставит отложенные ответы ассистента — веб в этом не участвует. */
export const aiReplyQueue = new Queue<AiReplyJob>(QUEUES.aiReply, { connection });

/**
 * Поставить ответ на серию сообщений клиента.
 *
 * Каждое сообщение ставит свою задачу с задержкой. Когда задача срабатывает,
 * она отвечает, только если её сообщение всё ещё последнее в диалоге, —
 * так серия «Здравствуйте / есть 42? / чёрные» получает один ответ через
 * N секунд после последнего сообщения, а не три ответа вдогонку.
 *
 * jobId = id сообщения: повтор задачи разбора не поставит второй ответ.
 */
export async function scheduleAiReply(job: AiReplyJob, delaySec: number) {
  await aiReplyQueue.add('reply', job, {
    jobId: `reply-${job.inboundMessageId}`,
    delay: Math.max(0, Math.min(120, delaySec)) * 1000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  });
}
