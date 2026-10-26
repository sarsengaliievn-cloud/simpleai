// Первая строка — загрузка .env. Порядок импортов здесь важен, см. env.ts.
import './env.js';

import { Worker } from 'bullmq';
import { QUEUES, type InboundMessageJob, type IngestDocumentJob } from '@wa/core';
import { prisma } from '@wa/db';
import { connection } from './redis.js';
import { processInboundMessage } from './processors/inbound-message.js';
import { ingestDocument } from './processors/ingest-document.js';

const worker = new Worker<InboundMessageJob>(
  QUEUES.inboundMessage,
  async (job) => processInboundMessage(job.data),
  { connection, concurrency: 5 },
);

const ingestWorker = new Worker<IngestDocumentJob>(
  QUEUES.ingestDocument,
  async (job) => ingestDocument(job.data),
  { connection, concurrency: 2 },
);
ingestWorker.on('failed', (job, err) => console.error(`[ingest] fail ${job?.id}:`, err.message));

worker.on('completed', (job) => console.log(`[worker] ok ${job.id}`));
worker.on('failed', (job, err) => console.error(`[worker] fail ${job?.id}:`, err.message));

console.log('[worker] запущен, слушаю очереди', QUEUES.inboundMessage, QUEUES.ingestDocument);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('[worker] останавливаюсь');
  await worker.close();
  await ingestWorker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
