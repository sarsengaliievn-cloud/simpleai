'use server';

import { revalidatePath } from 'next/cache';
import { deleteChunks } from '@wa/db';
import { requireCompany } from '@/lib/session';
import { extractText } from '@/lib/parse-upload';
import { ingestQueue, JOB_CLEANUP } from '@/lib/queue';
import { parseKnowledgeFile, sameText, type KnowledgeSection } from '@wa/core';
import { documentsWithText } from '@/lib/knowledge';

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
  const { company, db } = await requireCompany('knowledge:manage');
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

  // Файл, скачанный кнопкой «Скачать базу» и поправленный: обновляем
  // документы по их заголовкам, а не заводим одну большую копию.
  const sections = parseKnowledgeFile(text);
  if (sections) return applySections(company.id, db, sections, file.name);

  const doc = await db.knowledgeDocument.create({
    data: {
      title: file.name.slice(0, 200),
      source: file.name.slice(0, 200),
      mimeType: file.type || null,
      sizeBytes: file.size,
      status: 'PENDING',
      content: text,
    } as never,
  });

  await enqueue(company.id, doc.id, text);

  revalidatePath('/knowledge');
  return { ok: true as const };
}

export async function addManualNote(title: string, text: string) {
  const { company, db } = await requireCompany('knowledge:manage');
  if (text.trim().length < 30) return { ok: false as const, error: 'Слишком короткий текст — нужно хотя бы 30 символов' };
  if (text.length > MAX_TEXT) return { ok: false as const, error: 'Слишком длинный текст' };

  // Владельцы пишут в название сам вопрос клиента («Саламатсыз ба! 38 900
  // жеңілдікпен алғым келеді»), а в текст — ответ. Ищем по обоим.
  const heading = title.trim();
  const full = heading ? `${heading}\n\n${text}` : text;
  const doc = await db.knowledgeDocument.create({
    data: {
      title: heading.slice(0, 200) || 'Заметка',
      source: 'ручной ввод',
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      status: 'PENDING',
      content: full,
    } as never,
  });

  await enqueue(company.id, doc.id, full);

  revalidatePath('/knowledge');
  return { ok: true as const };
}

export async function removeDocument(documentId: string) {
  const { company, db } = await requireCompany('knowledge:manage');
  // Сначала убеждаемся, что документ свой: deleteChunks — сырой SQL,
  // он сам фильтрует по company_id, но лишний запрос в чужие данные не нужен.
  const doc = await db.knowledgeDocument.findFirst({ where: { id: documentId }, select: { id: true } });
  if (!doc) return;

  await deleteChunks(company.id, documentId);
  await db.knowledgeDocument.deleteMany({ where: { id: documentId } });
  revalidatePath('/knowledge');
}

/**
 * Сменили AI-провайдера (например, Gemini → ChatGPT): пересчитать векторы
 * всех готовых документов. Текст уже лежит в базе — заново загружать ничего не нужно.
 */
export async function reindexAll() {
  const { company, db } = await requireCompany('knowledge:manage');
  const docs = await db.knowledgeDocument.findMany({
    where: { status: { in: ['READY', 'FAILED'] }, chunkCount: { gt: 0 } },
    select: { id: true },
  });
  for (const doc of docs) {
    await db.knowledgeDocument.updateMany({ where: { id: doc.id }, data: { status: 'PENDING' } });
    await ingestQueue.add(
      'reembed',
      { companyId: company.id, documentId: doc.id, text: '', reembed: true },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, ...JOB_CLEANUP },
    );
  }
  revalidatePath('/knowledge');
  return { ok: true as const, count: docs.length };
}

type Db = Awaited<ReturnType<typeof requireCompany>>['db'];
type SectionsResult = { ok: true; updated: number; created: number; unchanged: number };

/** Заменить текст документа и переиндексировать. */
async function replaceText(companyId: string, db: Db, documentId: string, text: string, source?: string) {
  await db.knowledgeDocument.updateMany({
    where: { id: documentId },
    data: {
      content: text, sizeBytes: Buffer.byteLength(text, 'utf8'), status: 'PENDING', error: null,
      ...(source ? { source: source.slice(0, 200) } : {}),
    },
  });
  // Старые фрагменты воркер удалит сам перед записью новых — до этого бот
  // отвечает по старому тексту, без «дыры» в базе.
  await enqueue(companyId, documentId, text);
}

/**
 * Файл базы обратно: документ с меткой [#id] — заменяем, если текст
 * поменялся; без метки — ищем по названию, иначе это новый документ.
 * Документы, которых нет в файле, не трогаем.
 */
async function applySections(companyId: string, db: Db, sections: KnowledgeSection[], fileName: string): Promise<SectionsResult | { ok: false; error: string }> {
  const docs = await documentsWithText(db);
  const used = new Set<string>();
  const res: SectionsResult = { ok: true, updated: 0, created: 0, unchanged: 0 };
  for (const sec of sections) {
    if (sec.text.trim().length < 30) { res.unchanged += 1; continue; } // пустой раздел не стирает документ
    if (sec.text.length > MAX_TEXT) return { ok: false, error: `«${sec.title}»: слишком много текста — разбейте на части` };
    const byId = sec.idPrefix ? docs.find((d) => d.id.startsWith(sec.idPrefix!) && !used.has(d.id)) : undefined;
    const sameTitle = docs.filter((d) => !used.has(d.id) && d.title.trim().toLowerCase() === sec.title.toLowerCase());
    const doc = byId ?? (sameTitle.length === 1 ? sameTitle[0] : undefined);
    if (doc) {
      used.add(doc.id);
      if (sameText(doc.text, sec.text)) { res.unchanged += 1; continue; }
      if (doc.title !== sec.title) await db.knowledgeDocument.updateMany({ where: { id: doc.id }, data: { title: sec.title } });
      await replaceText(companyId, db, doc.id, sec.text, fileName);
      res.updated += 1;
    } else {
      const created = await db.knowledgeDocument.create({
        data: { title: sec.title, source: fileName.slice(0, 200), sizeBytes: Buffer.byteLength(sec.text, 'utf8'), status: 'PENDING', content: sec.text } as never,
      });
      await enqueue(companyId, created.id, sec.text);
      res.created += 1;
    }
  }
  revalidatePath('/knowledge');
  return res;
}

/** «Заменить» у документа: новый файл вместо старого, название остаётся. */
export async function replaceDocument(documentId: string, formData: FormData) {
  const { company, db } = await requireCompany('knowledge:manage');
  const doc = await db.knowledgeDocument.findFirst({ where: { id: documentId }, select: { id: true } });
  if (!doc) return { ok: false as const, error: 'Документ не найден — обновите страницу' };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: 'Файл не выбран' };
  if (file.size > 20 * 1024 * 1024) return { ok: false as const, error: 'Файл больше 20 МБ' };
  let text: string;
  try {
    text = await extractText(file);
  } catch (error) {
    return { ok: false as const, error: (error as Error).message };
  }
  const sections = parseKnowledgeFile(text);
  // Скачали один документ и вернули — внутри его же заголовок: берём текст под ним.
  if (sections) {
    if (sections.length > 1) return applySections(company.id, db, sections, file.name);
    text = sections[0]!.text;
  }
  if (text.trim().length < 30) return { ok: false as const, error: 'В файле не нашлось текста' };
  if (text.length > MAX_TEXT) return { ok: false as const, error: 'Слишком много текста — разбейте на части' };
  await db.knowledgeDocument.updateMany({ where: { id: documentId }, data: { mimeType: file.type || null } });
  await replaceText(company.id, db, documentId, text, file.name);
  revalidatePath('/knowledge');
  return { ok: true as const, updated: 1, created: 0, unchanged: 0 };
}

/** Поправить текст прямо на странице. */
export async function editDocumentText(documentId: string, title: string, text: string) {
  const { company, db } = await requireCompany('knowledge:manage');
  const doc = await db.knowledgeDocument.findFirst({ where: { id: documentId }, select: { id: true } });
  if (!doc) return { ok: false as const, error: 'Документ не найден — обновите страницу' };
  if (text.trim().length < 30) return { ok: false as const, error: 'Слишком короткий текст — нужно хотя бы 30 символов' };
  if (text.length > MAX_TEXT) return { ok: false as const, error: 'Слишком длинный текст' };
  if (title.trim()) await db.knowledgeDocument.updateMany({ where: { id: documentId }, data: { title: title.trim().slice(0, 200) } });
  await replaceText(company.id, db, documentId, text);
  revalidatePath('/knowledge');
  return { ok: true as const };
}

/** Текст документа для правки на странице. */
export async function getDocumentText(documentId: string) {
  const { db } = await requireCompany('knowledge:manage');
  const [doc] = await documentsWithText(db, [documentId]);
  return doc ? { ok: true as const, title: doc.title, text: doc.text } : { ok: false as const, error: 'Документ не найден' };
}
