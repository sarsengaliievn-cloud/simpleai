-- Закрытие диалогов и сделки «не продажа» (просто вопрос, спам)
ALTER TABLE "conversations" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "closeReason" TEXT;
ALTER TABLE "conversations" ADD COLUMN "closedById" UUID;
ALTER TABLE "deals" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "deals" ADD COLUMN "archiveReason" TEXT;
