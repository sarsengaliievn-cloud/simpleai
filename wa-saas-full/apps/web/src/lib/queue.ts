import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES } from '@wa/core';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const inboundMessageQueue = new Queue(QUEUES.inboundMessage, { connection });
