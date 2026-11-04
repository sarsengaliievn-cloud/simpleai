-- Быстрые ответы менеджеров и ответ бота на фото.
CREATE TABLE "quick_replies" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quick_replies_companyId_position_idx" ON "quick_replies"("companyId", "position");
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_configurations" ADD COLUMN "photoReply" TEXT NOT NULL DEFAULT '';
