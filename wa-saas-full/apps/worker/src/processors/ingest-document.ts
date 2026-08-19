import { prisma, forCompany, insertChunks, deleteChunks } from '@wa/db';
import { chunkText, estimateTokens, getAI } from '@wa/core';

/**
 * Разбор документа и построение эмбеддингов. Идёт в воркере, потому что
 * PDF на сто страниц режется и векторизуется десятки секунд — в HTTP-запросе
 * этому не место.
 */
export async function ingestDocument({ companyId, documentId, text }: {
  companyId: string; documentId: string; text: string;
}) {
  const db = forCompany(prisma, companyId);

  await db.knowledgeDocument.updateMany({
    where: { id: documentId },
    data: { status: 'PROCESSING', error: null },
  });

  try {
    // Переиндексация: старые чанки убираем, чтобы не двоились в поиске.
    await deleteChunks(companyId, documentId);

    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error('Из документа не удалось извлечь текст');

    const ai = getAI();
    let inserted = 0;

    // Пачками по 50 — иначе упираемся в лимит запроса эмбеддингов.
    for (let i = 0; i < chunks.length; i += 50) {
      const batch = chunks.slice(i, i + 50);
      const embeddings = await ai.embed(batch);

      inserted += await insertChunks(
        companyId,
        documentId,
        batch.map((content, j) => ({
          ordinal: i + j,
          content,
          tokens: estimateTokens(content),
          embedding: embeddings[j]!,
        })),
      );
    }

    await db.knowledgeDocument.updateMany({
      where: { id: documentId },
      data: { status: 'READY', chunkCount: inserted },
    });

    console.log(`[ingest] ${documentId}: ${inserted} фрагментов`);
  } catch (error) {
    await db.knowledgeDocument.updateMany({
      where: { id: documentId },
      data: { status: 'FAILED', error: (error as Error).message.slice(0, 500) },
    });
    throw error;
  }
}
