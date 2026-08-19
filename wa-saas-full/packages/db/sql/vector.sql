-- Выполняется ОДИН РАЗ после `prisma migrate`, потому что Prisma не умеет
-- ни колонку vector, ни индекс под неё.
--   psql "$DATABASE_URL" -f packages/db/sql/vector.sql

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- ivfflat подходит до сотен тысяч чанков. lists ≈ sqrt(количество строк).
-- Индекс строится по уже загруженным данным: если база пустая, создай его
-- повторно после первой массовой загрузки, иначе поиск пойдёт полным перебором.
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Поиск всегда идёт с фильтром по company_id, поэтому составной индекс полезен.
CREATE INDEX IF NOT EXISTS knowledge_chunks_company_idx
  ON knowledge_chunks ("companyId");
