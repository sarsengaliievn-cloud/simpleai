-- Интернет-заказы из склада и ключ интеграции
ALTER TABLE "companies" ADD COLUMN "orderHookHash" TEXT;
ALTER TABLE "companies" ADD COLUMN "orderHookAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "companies_orderHookHash_key" ON "companies"("orderHookHash");

CREATE TABLE "shop_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "number" TEXT,
    "phone" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "clientName" TEXT,
    "customerId" UUID,
    "dealId" UUID,
    "status" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "sellerName" TEXT,
    "city" TEXT,
    "carrier" TEXT,
    "track" TEXT,
    "trackUrl" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_orders_companyId_externalId_key" ON "shop_orders"("companyId", "externalId");
CREATE INDEX "shop_orders_companyId_phoneKey_idx" ON "shop_orders"("companyId", "phoneKey");
CREATE INDEX "shop_orders_companyId_customerId_orderedAt_idx" ON "shop_orders"("companyId", "customerId", "orderedAt");

ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
