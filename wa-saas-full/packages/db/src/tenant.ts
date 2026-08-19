import { PrismaClient } from '@prisma/client';

/**
 * Модели, у которых есть companyId. Любая новая таблица арендатора обязана
 * попасть в этот список — иначе она останется без автоматической фильтрации.
 * Тест tenant-isolation.test.ts проверяет, что список не отстал от схемы.
 */
export const TENANT_MODELS = new Set([
  'Membership',
  'WhatsAppAccount',
  'WhatsAppPhoneNumber',
  'Customer',
  'Conversation',
  'Message',
  'AuditLog',
  'AIConfiguration',
  'KnowledgeDocument',
  'KnowledgeChunk',
]);

/**
 * Операции, где Prisma принимает только уникальный where. Подмешать туда
 * companyId нельзя, поэтому мы их просто запрещаем для моделей арендатора:
 * findUnique заменяется на findFirst, update/delete — на updateMany/deleteMany.
 * Выглядит строго, но именно так закрывается дыра «нашёл запись по id из
 * другой компании».
 */
const FORBIDDEN_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

const SUGGESTIONS: Record<string, string> = {
  findUnique: 'findFirst',
  findUniqueOrThrow: 'findFirstOrThrow',
  update: 'updateMany',
  delete: 'deleteMany',
  upsert: 'findFirst + create/updateMany',
};

export class TenantScopeError extends Error {}

/**
 * Возвращает клиент, привязанный к одной компании. Весь код, обслуживающий
 * запрос пользователя, обязан ходить в БД только через него.
 */
export function forCompany(prisma: PrismaClient, companyId: string) {
  if (!companyId) {
    throw new TenantScopeError('forCompany вызван без companyId');
  }

  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) {
            return query(args);
          }

          if (FORBIDDEN_OPERATIONS.has(operation)) {
            throw new TenantScopeError(
              `${model}.${operation}() запрещён для данных арендатора: ` +
                `используй ${SUGGESTIONS[operation]}, он проходит через фильтр по компании.`,
            );
          }

          const scoped = args as Record<string, unknown>;

          switch (operation) {
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
            case 'updateMany':
            case 'deleteMany': {
              scoped.where = { ...((scoped.where as object) ?? {}), companyId };
              break;
            }
            case 'create': {
              scoped.data = { ...((scoped.data as object) ?? {}), companyId };
              break;
            }
            case 'createMany': {
              const data = scoped.data;
              scoped.data = Array.isArray(data)
                ? data.map((row) => ({ ...(row as object), companyId }))
                : { ...((data as object) ?? {}), companyId };
              break;
            }
            default:
              throw new TenantScopeError(
                `Операция ${model}.${operation}() не описана в tenant-расширении. ` +
                  'Добавь её явно, прежде чем использовать.',
              );
          }

          return query(scoped);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof forCompany>;
