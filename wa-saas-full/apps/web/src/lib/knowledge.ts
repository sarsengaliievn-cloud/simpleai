import { joinChunks } from '@wa/core';
import type { requireCompany } from './session';

type Db = Awaited<ReturnType<typeof requireCompany>>['db'];

/**
 * Документы базы с их текстом. Старые документы исходник не хранили —
 * собираем текст из фрагментов (перекрытия между ними убираются).
 */
export async function documentsWithText(db: Db, ids?: string[]) {
  const docs = await db.knowledgeDocument.findMany({
    where: ids ? { id: { in: ids } } : {},
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, source: true, content: true, status: true },
  });
  const missing = docs.filter((d) => d.content === null).map((d) => d.id);
  const parts = new Map<string, string[]>();
  for (let i = 0; i < missing.length; i += 200) {
    const rows = await db.knowledgeChunk.findMany({
      where: { documentId: { in: missing.slice(i, i + 200) } },
      orderBy: [{ documentId: 'asc' }, { ordinal: 'asc' }],
      select: { documentId: true, content: true },
    });
    for (const r of rows) parts.set(r.documentId, [...(parts.get(r.documentId) ?? []), r.content]);
  }
  return docs.map((d) => ({ ...d, text: d.content ?? joinChunks(parts.get(d.id) ?? []) }));
}
