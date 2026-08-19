import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Глобальный клиент без привязки к компании. Использовать напрямую можно
 * только там, где арендатора ещё нет: регистрация, приём вебхука,
 * супер-админка. Во всём остальном коде — forCompany().
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
