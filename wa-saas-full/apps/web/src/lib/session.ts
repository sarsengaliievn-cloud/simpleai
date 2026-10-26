import { redirect } from 'next/navigation';
import { prisma, forCompany, type Role } from '@wa/db';
import { getSessionUser } from './auth';

/**
 * Компания текущего пользователя. Всё, что работает с данными арендатора,
 * начинается отсюда: db уже привязан к нужной компании.
 */
export async function requireCompany() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { company: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) redirect('/login');

  return {
    user,
    company: membership.company,
    role: membership.role as Role,
    db: forCompany(prisma, membership.companyId),
  };
}

/** Мягкая версия для страниц, доступных и без входа. */
export async function getCurrentUser() {
  return getSessionUser();
}
