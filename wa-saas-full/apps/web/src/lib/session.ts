import { prisma, forCompany } from '@wa/db';

/**
 * ВРЕМЕННО. Авторизации ещё нет (спринт 1), поэтому компания берётся из
 * DEV_COMPANY_ID или просто первая в базе. Как только появится сессия,
 * меняется только тело этой функции — весь остальной код уже написан так,
 * будто арендатор приходит из сессии.
 */
export async function requireCompany() {
  const id = process.env.DEV_COMPANY_ID;
  const company = id
    ? await prisma.company.findUnique({ where: { id } })
    : await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!company) {
    throw new Error('Нет ни одной компании. Запусти pnpm db:seed.');
  }

  return { company, db: forCompany(prisma, company.id) };
}
