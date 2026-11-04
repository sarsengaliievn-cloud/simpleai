-- Каталог склада для ответов бота: наличие, размеры, цены, фото
ALTER TABLE "ai_configurations" ADD COLUMN "catalogUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ai_configurations" ADD COLUMN "catalogProductUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ai_configurations" ADD COLUMN "catalogPhotoUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ai_configurations" ADD COLUMN "catalogPhotos" BOOLEAN NOT NULL DEFAULT true;
