import { Prisma } from '@prisma/client';
import { prisma } from './client.js';

/**
 * ВНИМАНИЕ. Здесь сырой SQL, а значит tenant-расширение из tenant.ts НЕ
 * работает: оно перехватывает только методы моделей. Каждый запрос в этом
 * файле обязан сам фильтровать по company_id — это единственное место
 * в проекте, где изоляция держится на внимательности, поэтому все функции
 * принимают companyId первым аргументом и он всегда попадает в WHERE.
 */

export type ChunkInput = { ordinal: number; content: string; tokens: number; embedding: number[] };

export async function insertChunks(
  companyId: string,
  documentId: string,
  chunks: ChunkInput[],
): Promise<number> {
  let inserted = 0;

  for (const chunk of chunks) {
    const literal = `[${chunk.embedding.join(',')}]`;
    await prisma.$executeRaw`
      INSERT INTO knowledge_chunks (id, "companyId", "documentId", ordinal, content, tokens, "createdAt", embedding)
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${documentId}::uuid, ${chunk.ordinal},
              ${chunk.content}, ${chunk.tokens}, now(), ${literal}::vector)
    `;
    inserted += 1;
  }

  return inserted;
}

export type SearchHit = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  ordinal: number;
  content: string;
  /** 0..1, чем ближе к 1 — тем точнее совпадение. */
  score: number;
};

export async function searchChunks(
  companyId: string,
  embedding: number[],
  limit = 5,
): Promise<SearchHit[]> {
  const literal = `[${embedding.join(',')}]`;

  const rows = await prisma.$queryRaw<
    Array<{ chunkId: string; documentId: string; documentTitle: string; ordinal: number; content: string; distance: number }>
  >(Prisma.sql`
    SELECT c.id            AS "chunkId",
           c."documentId"  AS "documentId",
           d.title         AS "documentTitle",
           c.ordinal       AS "ordinal",
           c.content       AS "content",
           (c.embedding <=> ${literal}::vector) AS "distance"
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c."documentId"
    WHERE c."companyId" = ${companyId}::uuid
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);

  // Косинусное расстояние 0..2 → удобная оценка близости 0..1.
  return rows.map((r) => ({ ...r, score: Math.max(0, 1 - Number(r.distance)) }));
}

export async function deleteChunks(companyId: string, documentId: string) {
  await prisma.$executeRaw`
    DELETE FROM knowledge_chunks
    WHERE "companyId" = ${companyId}::uuid AND "documentId" = ${documentId}::uuid
  `;
}
