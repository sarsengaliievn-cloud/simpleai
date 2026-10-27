import { prisma, forCompany, insertChunks, deleteChunks, updateChunkEmbedding } from '@wa/db';
import { chunkText, estimateTokens, getAIFor, resolveAI, embedFamily, billingProvider, hasBalance, recordUsage } from '@wa/core';

/**
 * Разбор документа и построение эмбеддингов. Идёт в воркере, потому что
 * PDF на сто страниц режется и векторизуется десятки секунд — в HTTP-запросе
 * этому не место.
 */
export async function ingestDocument({ companyId, documentId, text, reembed }: {
  companyId: string; documentId: string; text: string; reembed?: boolean;
}) {
  const db = forCompany(prisma, companyId);
  if (reembed) return reembedDocument(companyId, documentId);
  const choice = resolveAI(await db.aIConfiguration.findFirst());

  await db.knowledgeDocument.updateMany({
    where: { id: documentId },
    data: { status: 'PROCESSING', error: null },
  });

  try {
    // Переиндексация: старые чанки убираем, чтобы не двоились в поиске.
    await deleteChunks(companyId, documentId);

    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error('Из документа не удалось извлечь текст');
    if (!(await hasBalance(companyId))) throw new Error('Баланс ИИ закончился — пополните его в разделе «Баланс» и загрузите документ снова');

    const ai = getAIFor(choice);
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

    await recordUsage(companyId, 'knowledge', {
      provider: billingProvider(choice),
      model: choice.model,
      embedTokens: chunks.reduce((sum, c) => sum + estimateTokens(c), 0),
    });
    await db.knowledgeDocument.updateMany({
      where: { id: documentId },
      data: { status: 'READY', chunkCount: inserted, embedProvider: embedFamily(choice) },
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

/**
 * Сменили AI-провайдера: текст фрагментов тот же, пересчитываем только
 * векторы. Документы заново загружать не нужно.
 */
async function reembedDocument(companyId: string, documentId: string) {
  const db = forCompany(prisma, companyId);
  await db.knowledgeDocument.updateMany({ where: { id: documentId }, data: { status: 'PROCESSING', error: null } });

  try {
    const chunks = await db.knowledgeChunk.findMany({
      where: { documentId },
      orderBy: { ordinal: 'asc' },
      select: { id: true, content: true },
    });
    const choice = resolveAI(await db.aIConfiguration.findFirst());
    const ai = getAIFor(choice);
    for (let i = 0; i < chunks.length; i += 50) {
      const batch = chunks.slice(i, i + 50);
      const embeddings = await ai.embed(batch.map((c) => c.content));
      for (const [j, chunk] of batch.entries()) {
        await updateChunkEmbedding(companyId, chunk.id, embeddings[j]!);
      }
    }
    await recordUsage(companyId, 'knowledge', {
      provider: billingProvider(choice),
      model: choice.model,
      embedTokens: chunks.reduce((sum, c) => sum + estimateTokens(c.content), 0),
    });
    await db.knowledgeDocument.updateMany({
      where: { id: documentId },
      data: { status: 'READY', embedProvider: embedFamily(choice) },
    });
    console.log(`[ingest] ${documentId}: индекс обновлён (${chunks.length} фрагментов, ${embedFamily(choice)})`);
  } catch (error) {
    await db.knowledgeDocument.updateMany({
      where: { id: documentId },
      data: { status: 'FAILED', error: (error as Error).message.slice(0, 500) },
    });
    throw error;
  }
}
