-- Начальная миграция: вся схема ядра, включая колонку эмбеддингов.
-- Заменяет ручной vector.sql. Индекса ivfflat здесь нет намеренно: поиск
-- всегда идёт внутри одной компании (WHERE "companyId" = ...), и приблизительный
-- индекс с таким фильтром может вернуть меньше фрагментов, чем просили, а
-- построенный на пустой таблице — вообще мусор. Точный перебор по индексу
-- companyId для объёмов одной компании быстрый и всегда честный.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";


CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'ANALYST');
CREATE TYPE "ConnectionMethod" AS ENUM ('EMBEDDED_SIGNUP', 'MANUAL');
CREATE TYPE "IntegrationStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED');
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');
CREATE TYPE "ConversationMode" AS ENUM ('AI', 'HUMAN');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'LOCATION', 'TEMPLATE', 'UNSUPPORTED');
CREATE TYPE "AuthorType" AS ENUM ('CUSTOMER', 'AI', 'MANAGER', 'SYSTEM');
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "IngestStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "users" (
  "id" UUID NOT NULL, "email" TEXT NOT NULL, "emailVerified" TIMESTAMP(3), "passwordHash" TEXT NOT NULL,
  "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "sessions" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "sessionToken" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "ip" TEXT, "userAgent" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

CREATE TABLE "verification_tokens" (
  "id" UUID NOT NULL, "identifier" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "type" "VerificationTokenType" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");
CREATE INDEX "verification_tokens_identifier_type_idx" ON "verification_tokens"("identifier", "type");

CREATE TABLE "companies" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "industry" TEXT, "country" TEXT, "city" TEXT,
  "website" TEXT, "description" TEXT, "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

CREATE TABLE "memberships" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "companyId" UUID NOT NULL, "role" "Role" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "memberships_userId_companyId_key" ON "memberships"("userId", "companyId");
CREATE INDEX "memberships_companyId_idx" ON "memberships"("companyId");

CREATE TABLE "whatsapp_accounts" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "wabaId" TEXT NOT NULL, "businessName" TEXT, "accessToken" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3), "connectedVia" "ConnectionMethod" NOT NULL,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING', "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "whatsapp_accounts_companyId_wabaId_key" ON "whatsapp_accounts"("companyId", "wabaId");
CREATE INDEX "whatsapp_accounts_companyId_idx" ON "whatsapp_accounts"("companyId");

CREATE TABLE "whatsapp_phone_numbers" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "accountId" UUID NOT NULL, "phoneNumberId" TEXT NOT NULL,
  "displayPhoneNumber" TEXT NOT NULL, "verifiedName" TEXT, "qualityRating" TEXT, "messagingLimit" TEXT,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING', "webhookVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_phone_numbers_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "whatsapp_phone_numbers_phoneNumberId_key" ON "whatsapp_phone_numbers"("phoneNumberId");
CREATE INDEX "whatsapp_phone_numbers_companyId_idx" ON "whatsapp_phone_numbers"("companyId");

CREATE TABLE "customers" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "waId" TEXT NOT NULL, "phone" TEXT NOT NULL, "name" TEXT,
  "email" TEXT, "city" TEXT, "notes" TEXT,
  "firstContactAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastContactAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "customers_companyId_waId_key" ON "customers"("companyId", "waId");
CREATE INDEX "customers_companyId_lastContactAt_idx" ON "customers"("companyId", "lastContactAt");

CREATE TABLE "conversations" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "customerId" UUID NOT NULL, "phoneNumberId" UUID,
  "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN', "mode" "ConversationMode" NOT NULL DEFAULT 'AI',
  "assigneeId" UUID, "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "windowExpiresAt" TIMESTAMP(3),
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"));
CREATE INDEX "conversations_companyId_status_lastMessageAt_idx" ON "conversations"("companyId", "status", "lastMessageAt");
CREATE INDEX "conversations_companyId_customerId_idx" ON "conversations"("companyId", "customerId");

CREATE TABLE "messages" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "conversationId" UUID NOT NULL, "direction" "MessageDirection" NOT NULL,
  "type" "MessageType" NOT NULL DEFAULT 'TEXT', "authorType" "AuthorType" NOT NULL, "authorUserId" UUID,
  "text" TEXT, "mediaUrl" TEXT, "mediaMimeType" TEXT, "providerMessageId" TEXT,
  "status" "MessageStatus" NOT NULL DEFAULT 'PENDING', "errorCode" TEXT, "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "metadata" JSONB,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "messages_companyId_providerMessageId_key" ON "messages"("companyId", "providerMessageId");
CREATE INDEX "messages_companyId_conversationId_createdAt_idx" ON "messages"("companyId", "conversationId", "createdAt");

CREATE TABLE "webhook_events" (
  "id" UUID NOT NULL, "companyId" UUID, "source" TEXT NOT NULL DEFAULT 'whatsapp', "externalId" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED', "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" TIMESTAMP(3),
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "webhook_events_externalId_key" ON "webhook_events"("externalId");
CREATE INDEX "webhook_events_status_receivedAt_idx" ON "webhook_events"("status", "receivedAt");

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "actorUserId" UUID, "action" TEXT NOT NULL, "entityType" TEXT,
  "entityId" TEXT, "metadata" JSONB, "ip" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"));
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");

CREATE TABLE "ai_configurations" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6', "role" TEXT NOT NULL DEFAULT 'Консультант компании',
  "goals" TEXT[] DEFAULT ARRAY[]::TEXT[], "tone" TEXT NOT NULL DEFAULT 'Дружелюбный',
  "languages" TEXT[] DEFAULT ARRAY['ru']::TEXT[], "forbidden" TEXT NOT NULL DEFAULT '', "extraRules" TEXT NOT NULL DEFAULT '',
  "confidenceThreshold" INTEGER NOT NULL DEFAULT 70, "advancedMode" BOOLEAN NOT NULL DEFAULT false,
  "advancedPrompt" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_configurations_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ai_configurations_companyId_key" ON "ai_configurations"("companyId");

CREATE TABLE "knowledge_documents" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "title" TEXT NOT NULL, "source" TEXT NOT NULL, "mimeType" TEXT,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0, "status" "IngestStatus" NOT NULL DEFAULT 'PENDING', "error" TEXT,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id"));
CREATE INDEX "knowledge_documents_companyId_createdAt_idx" ON "knowledge_documents"("companyId", "createdAt");

CREATE TABLE "knowledge_chunks" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "documentId" UUID NOT NULL, "ordinal" INTEGER NOT NULL,
  "content" TEXT NOT NULL, "tokens" INTEGER NOT NULL DEFAULT 0, "embedding" vector(1536), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id"));
CREATE INDEX "knowledge_chunks_companyId_documentId_idx" ON "knowledge_chunks"("companyId", "documentId");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_phone_numbers" ADD CONSTRAINT "whatsapp_phone_numbers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_phone_numbers" ADD CONSTRAINT "whatsapp_phone_numbers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "whatsapp_phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
