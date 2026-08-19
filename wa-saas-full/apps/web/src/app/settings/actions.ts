'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@wa/db';
import { requireCompany } from '@/lib/session';

export async function saveCompany(formData: FormData) {
  const { company, db } = await requireCompany();

  const data = {
    name: String(formData.get('name') ?? '').trim() || company.name,
    city: String(formData.get('city') ?? '').trim() || null,
    country: String(formData.get('country') ?? '').trim() || null,
    website: String(formData.get('website') ?? '').trim() || null,
    description: String(formData.get('description') ?? '').trim() || null,
  };

  // Company не входит в tenant-модели (это и есть сам арендатор),
  // поэтому обновляем напрямую, но строго по своему id.
  await prisma.company.update({ where: { id: company.id }, data });

  await db.auditLog.create({
    data: { action: 'company.updated', entityType: 'Company', entityId: company.id } as never,
  });

  revalidatePath('/settings');
}
