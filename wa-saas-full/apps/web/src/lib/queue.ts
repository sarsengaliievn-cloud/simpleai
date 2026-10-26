import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES } from '@wa/core';

/**
 * Одно подключение к Redis на процесс. В dev Next перезагружает модули
 * при каждой правке — без globalThis копились бы десятки соединений.
 */
const g = globalThis as unknown as { waRedis?: IORedis; waQueues?: Record<string, Queue> };

const connection =
  g.waRedis ??
  new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

const queues = g.waQueues ?? {
  inbound: new Queue(QUEUES.inboundMessage, { connection }),
  ingest: new Queue(QUEUES.ingestDocument, { connection }),
};

if (process.env.NODE_ENV !== 'production') {
  g.waRedis = connection;
  g.waQueues = queues;
}

export const inboundMessageQueue = queues.inbound!;
export const ingestQueue = queues.ingest!;

/**
 * Готовые задачи убираем из Redis: в задаче индексации лежит весь текст
 * документа, и без очистки Redis растёт с каждой загрузкой.
 */
export const JOB_CLEANUP = {
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;
