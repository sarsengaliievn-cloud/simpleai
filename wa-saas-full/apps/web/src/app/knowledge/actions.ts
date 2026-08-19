'use server';

import { revalidatePath } from 'next/cache';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES } from '@wa/core';
import { deleteChunks } from '@wa/db';
import { requireCompany } from '@/lib/session';
import { extractText } from '@/lib/parse-upload';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const ingestQueue = new Queue(QUEUES.ingestDocument, { connection });

export async function uploadDocument(formData: FormData) {
  const { company, db } = await requireCompany();
  const file = formData.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false as const, error: 'Файл не выбран' };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { ok: false as const, error: 'Файл больше 20 МБ' };
  }

  let text: string;
  try {
    text = await extractText(file);
  } catch (error) {
    return { ok: false as const, error: (error as Error).message };
  }

  if (text.trim().length < 30) {
    return { ok: false as const, error: 'В файле не нашлось текста. Если это скан — нужен OCR.' };
  }

  const doc = await db.knowledgeDocument.create({
    data: {
      title: file.name,
      source: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      status: 'PENDING',
    } as never,
  });

  await ingestQueue.add('ingest', { companyId: company.id, documentId: doc.id, text });

  revalidatePath('/knowledge');
  return { ok: true as const };
}

export async function addManualNote(title: string, text: string) {
  const { company, db } = await requireCompany();
  if (text.trim().length < 30) return { ok: false as const, error: 'Слишком короткий текст' };

  const doc = await db.knowledgeDocument.create({
    data: { title: title.trim() || 'Заметка', source: 'ручной ввод', sizeBytes: text.length, status: 'PENDING' } as never,
  });

  await ingestQueue.add('ingest', { companyId: company.id, documentId: doc.id, text });

  revalidatePath('/knowledge');
  return { ok: true as const };
}

export async function removeDocument(documentId: string) {
  const { company, db } = await requireCompany();
  await deleteChunks(company.id, documentId);
  await db.knowledgeDocument.deleteMany({ where: { id: documentId } });
  revalidatePath('/knowledge');
}
