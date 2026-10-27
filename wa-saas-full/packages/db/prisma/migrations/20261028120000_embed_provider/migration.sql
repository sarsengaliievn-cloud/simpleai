-- Чьими эмбеддингами построен индекс документа. Уже построенные — Gemini:
-- до появления OpenAI других вариантов на серверах не было.
ALTER TABLE "knowledge_documents" ADD COLUMN "embedProvider" TEXT;
UPDATE "knowledge_documents" SET "embedProvider" = 'gemini' WHERE "status" = 'READY';
