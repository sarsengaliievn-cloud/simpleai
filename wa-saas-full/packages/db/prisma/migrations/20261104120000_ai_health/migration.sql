-- Последний сбой ИИ компании: показываем плашку «ИИ не работает», пока
-- следующий ответ не пройдёт успешно.
ALTER TABLE "ai_configurations" ADD COLUMN "lastErrorAt" TIMESTAMP(3);
ALTER TABLE "ai_configurations" ADD COLUMN "lastError" TEXT;
