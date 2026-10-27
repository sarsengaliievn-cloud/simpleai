-- Автоматизация ассистента: буферизация, ответ частями, рабочие часы, голосовые.
-- Все колонки с умолчаниями — существующие настройки компаний продолжают работать.
ALTER TABLE "ai_configurations"
  ADD COLUMN "replyDelaySec" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "splitReplies" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "splitMaxChars" INTEGER NOT NULL DEFAULT 350,
  ADD COLUMN "workingHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
  ADD COLUMN "workStart" TEXT NOT NULL DEFAULT '09:00',
  ADD COLUMN "workEnd" TEXT NOT NULL DEFAULT '21:00',
  ADD COLUMN "offHoursMessage" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "transcribeVoice" BOOLEAN NOT NULL DEFAULT true;
