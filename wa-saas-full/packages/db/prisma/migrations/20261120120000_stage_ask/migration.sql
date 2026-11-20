-- Вопрос бота на этапе воронки: «Придёте в магазин?» после вопроса об адресе
ALTER TABLE "pipeline_stages" ADD COLUMN "aiAsk" TEXT;
