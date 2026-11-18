-- ИИ сам переносит клиентов по этапам воронки
ALTER TABLE "companies" ADD COLUMN "aiStages" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "companies" ADD COLUMN "noAnswerDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "pipeline_stages" ADD COLUMN "aiHint" TEXT;
ALTER TABLE "deals" ADD COLUMN "manualStageAt" TIMESTAMP(3);
ALTER TABLE "deals" ADD COLUMN "aiStageAt" TIMESTAMP(3);
