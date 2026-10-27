import { redirect } from 'next/navigation';
import { prisma, forCompany, type Role } from '@wa/db';
import { can, type Permission } from '@wa/core';
import { getSessionUser } from './auth';

/** Менеджер и оператор видят только переданных им клиентов. */
export function seesOnlyOwn(role: Role) {
  return role === 'MANAGER' || role === 'OPERATOR';
}

/**
 * Компания текущего пользователя. Всё, что работает с данными арендатора,
 * начинается отсюда: db уже привязан к нужной компании.
 *
 * permission — право на раздел. Без него страница и действие уводят в
 * «Диалоги»: менеджер не попадёт в настройки ассистента даже по прямой ссылке.
 */
export async function requireCompany(permission?: Permission) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { company: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) redirect('/login?closed=1');

  const role = membership.role as Role;
  if (permission && !can(role, permission)) redirect('/conversations');

  const own = seesOnlyOwn(role);
  return {
    user,
    company: membership.company,
    role,
    db: forCompany(prisma, membership.companyId),
    /** Фильтр «только свои» для диалогов и сделок; для владельца — пусто. */
    ownConversations: own ? { assigneeId: user.id } : {},
    ownDeals: own ? { assigneeId: user.id } : {},
    seesOnlyOwn: own,
  };
}

/** Мягкая версия для страниц, доступных и без входа. */
export async function getCurrentUser() {
  return getSessionUser();
}
