-- CRM: этапы воронки, сделки и их история.

CREATE TYPE "StageKind" AS ENUM ('NEW', 'WORK', 'ORDER', 'WON', 'LOST');

CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StageKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "conversationId" UUID,
    "stageId" UUID NOT NULL,
    "assigneeId" UUID,
    "amount" INTEGER,
    "product" TEXT,
    "comment" TEXT,
    "lostReason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deal_events" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "actorUserId" UUID,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pipeline_stages_companyId_position_idx" ON "pipeline_stages"("companyId", "position");
CREATE INDEX "deals_companyId_stageId_idx" ON "deals"("companyId", "stageId");
CREATE INDEX "deals_companyId_assigneeId_idx" ON "deals"("companyId", "assigneeId");
CREATE INDEX "deals_companyId_createdAt_idx" ON "deals"("companyId", "createdAt");
CREATE INDEX "deals_companyId_customerId_idx" ON "deals"("companyId", "customerId");
CREATE INDEX "deal_events_companyId_dealId_createdAt_idx" ON "deal_events"("companyId", "dealId", "createdAt");

ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Этапы по умолчанию для уже существующих компаний.
INSERT INTO "pipeline_stages" ("id", "companyId", "name", "kind", "position", "updatedAt")
SELECT gen_random_uuid(), c."id", s.name, s.kind::"StageKind", s.position, CURRENT_TIMESTAMP
FROM "companies" c
CROSS JOIN (VALUES
    ('Новый', 'NEW', 0),
    ('У менеджера', 'WORK', 1),
    ('Думает', 'WORK', 2),
    ('Новый заказ', 'ORDER', 3),
    ('Выдан', 'WON', 4),
    ('Отказ', 'LOST', 5)
) AS s(name, kind, position);

-- Уже существующим клиентам — по сделке: «Новый», а если диалог ведёт
-- менеджер — «У менеджера». Дата — первое обращение, чтобы аналитика за
-- прошлые дни не исказилась.
INSERT INTO "deals" ("id", "companyId", "customerId", "conversationId", "stageId", "assigneeId",
                     "stageChangedAt", "assignedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), cu."companyId", cu."id", conv."id",
       (SELECT ps."id" FROM "pipeline_stages" ps
         WHERE ps."companyId" = cu."companyId"
           AND ps."position" = CASE WHEN conv."mode" = 'HUMAN' THEN 1 ELSE 0 END),
       conv."assigneeId",
       cu."firstContactAt",
       CASE WHEN conv."mode" = 'HUMAN' THEN cu."lastContactAt" END,
       cu."firstContactAt", CURRENT_TIMESTAMP
FROM "customers" cu
LEFT JOIN LATERAL (
    SELECT c."id", c."mode", c."assigneeId" FROM "conversations" c
     WHERE c."customerId" = cu."id"
     ORDER BY c."lastMessageAt" DESC LIMIT 1
) conv ON true;
