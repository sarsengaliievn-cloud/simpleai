'use server';

import { revalidatePath } from 'next/cache';
import { deleteChunks } from '@wa/db';
import { requireCompany } from '@/lib/session';
import { extractText } from '@/lib/parse-upload';
import { ingestQueue, JOB_CLEANUP } from '@/lib/queue';

const MAX_TEXT = 2_000_000; // ~2 млн символов — больше уже не прайс, а выгрузка базы.

async function enqueue(companyId: string, documentId: string, text: string) {
  await ingestQueue.add(
    'ingest',
    { companyId, documentId, text },
    // Эмбеддинги — внешний API: временный сбой не должен навсегда
    // оставлять документ в «Ошибке».
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, ...JOB_CLEANUP },
  );
}

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
  if (text.length > MAX_TEXT) {
    return { ok: false as const, error: 'Слишком много текста в одном файле — разбейте его на части.' };
  }

  const doc = await db.knowledgeDocument.create({
    data: {
      title: file.name.slice(0, 200),
      source: file.name.slice(0, 200),
      mimeType: file.type || null,
      sizeBytes: file.size,
      status: 'PENDING',
    } as never,
  });

  await enqueue(company.id, doc.id, text);

  revalidatePath('/knowledge');
  return { ok: true as const };
}

export async function addManualNote(title: string, text: string) {
  const { company, db } = await requireCompany();
  if (text.trim().length < 30) return { ok: false as const, error: 'Слишком короткий текст — нужно хотя бы 30 символов' };
  if (text.length > MAX_TEXT) return { ok: false as const, error: 'Слишком длинный текст' };

  const doc = await db.knowledgeDocument.create({
    data: {
      title: title.trim().slice(0, 200) || 'Заметка',
      source: 'ручной ввод',
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      status: 'PENDING',
    } as never,
  });

  await enqueue(company.id, doc.id, text);

  revalidatePath('/knowledge');
  return { ok: true as const };
}

export async function removeDocument(documentId: string) {
  const { company, db } = await requireCompany();
  // Сначала убеждаемся, что документ свой: deleteChunks — сырой SQL,
  // он сам фильтрует по company_id, но лишний запрос в чужие данные не нужен.
  const doc = await db.knowledgeDocument.findFirst({ where: { id: documentId }, select: { id: true } });
  if (!doc) return;

  await deleteChunks(company.id, documentId);
  await db.knowledgeDocument.deleteMany({ where: { id: documentId } });
  revalidatePath('/knowledge');
}
