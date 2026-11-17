-- Какой статус заказа из склада ведёт на какой этап воронки
ALTER TABLE "companies" ADD COLUMN "orderStageMap" JSONB;
