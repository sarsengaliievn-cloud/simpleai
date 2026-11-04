-- Свои причины отказа, авто-распределение, порог «зависших»
ALTER TABLE "companies" ADD COLUMN "lostReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "companies" ADD COLUMN "autoAssign" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "staleHours" INTEGER NOT NULL DEFAULT 24;

-- Смены менеджеров
ALTER TABLE "memberships" ADD COLUMN "onShift" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "memberships" ADD COLUMN "shiftStartedAt" TIMESTAMP(3);
ALTER TABLE "memberships" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "memberships" ADD COLUMN "lastAssignedAt" TIMESTAMP(3);

-- Реклама и напоминания в сделке
ALTER TABLE "deals" ADD COLUMN "adHeadline" TEXT;
ALTER TABLE "deals" ADD COLUMN "adSourceId" TEXT;
ALTER TABLE "deals" ADD COLUMN "adSourceUrl" TEXT;
ALTER TABLE "deals" ADD COLUMN "adSourceType" TEXT;
ALTER TABLE "deals" ADD COLUMN "remindAt" TIMESTAMP(3);
ALTER TABLE "deals" ADD COLUMN "remindNote" TEXT;
CREATE INDEX "deals_companyId_remindAt_idx" ON "deals"("companyId", "remindAt");
