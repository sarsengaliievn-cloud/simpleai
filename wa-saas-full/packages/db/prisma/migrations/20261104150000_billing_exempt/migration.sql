-- Компания без внутреннего баланса ИИ (своя компания владельца платформы):
-- расход считается для статистики, но не списывается и бот не останавливается.
ALTER TABLE "companies" ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false;
