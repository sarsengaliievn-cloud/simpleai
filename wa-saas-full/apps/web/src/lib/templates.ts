import type { TenantClient } from '@wa/db';

/** Одобренные шаблоны для отправки из переписки. */
export async function approvedTemplates(db: TenantClient, accountId: string | null) {
  // Шаблон живёт в аккаунте WhatsApp: с другого номера его отправить нельзя.
  const rows = await db.messageTemplate.findMany({ where: { status: 'APPROVED', ...(accountId ? { accountId } : {}) }, orderBy: { createdAt: 'asc' } });
  return rows.map((t) => ({ id: t.id, title: t.title, body: t.body, variables: t.variables }));
}
