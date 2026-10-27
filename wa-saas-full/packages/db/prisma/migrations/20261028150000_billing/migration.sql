-- Баланс ИИ: списания, пополнения, заявки, настройки платформы.

ALTER TABLE "companies" ADD COLUMN "balanceTiyn" INTEGER NOT NULL DEFAULT 0,
                        ADD COLUMN "lastTopupTiyn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_configurations" ADD COLUMN "aiProvider" TEXT,
                                ADD COLUMN "aiModel" TEXT;

CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "embedTokens" INTEGER NOT NULL DEFAULT 0,
    "audioSeconds" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "chargeTiyn" INTEGER NOT NULL DEFAULT 0,
    "conversationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "balance_transactions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amountTiyn" INTEGER NOT NULL,
    "balanceAfterTiyn" INTEGER NOT NULL,
    "note" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "topup_requests" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "amountTiyn" INTEGER NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "requestedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "topup_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ai_usage_companyId_createdAt_idx" ON "ai_usage"("companyId", "createdAt");
CREATE INDEX "balance_transactions_companyId_createdAt_idx" ON "balance_transactions"("companyId", "createdAt");
CREATE INDEX "topup_requests_companyId_createdAt_idx" ON "topup_requests"("companyId", "createdAt");
CREATE INDEX "topup_requests_status_createdAt_idx" ON "topup_requests"("status", "createdAt");

ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "topup_requests" ADD CONSTRAINT "topup_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Уже работающие компании не должны остаться без ответов бота в момент
-- обновления: стартовый баланс 5 000 ₸.
UPDATE "companies" SET "balanceTiyn" = 500000, "lastTopupTiyn" = 500000;
INSERT INTO "balance_transactions" ("id", "companyId", "kind", "amountTiyn", "balanceAfterTiyn", "note")
SELECT gen_random_uuid(), "id", 'bonus', 500000, 500000, 'Стартовый баланс при запуске оплаты ИИ'
FROM "companies";
