'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@wa/db';
import { requireCompany } from '@/lib/session';

export async function saveCompany(formData: FormData) {
  const { company, db } = await requireCompany('settings:manage');

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

/* ── Быстрые ответы ─────────────────────────────────────────── */

export async function addQuickReply(formData: FormData) {
  const { db } = await requireCompany('settings:manage');
  const title = String(formData.get('title') ?? '').trim().slice(0, 60);
  const text = String(formData.get('text') ?? '').trim().slice(0, 4000);
  if (!title || !text) return;
  const count = await db.quickReply.count();
  if (count >= 50) return;
  await db.quickReply.create({ data: { title, text, position: count } as never });
  revalidatePath('/settings');
  revalidatePath('/conversations');
}

export async function deleteQuickReply(formData: FormData) {
  const { db } = await requireCompany('settings:manage');
  const id = String(formData.get('id') ?? '');
  await db.quickReply.deleteMany({ where: { id } });
  revalidatePath('/settings');
  revalidatePath('/conversations');
}
