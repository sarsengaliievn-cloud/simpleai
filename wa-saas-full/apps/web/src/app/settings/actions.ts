'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@wa/db';
import { requireCompany } from '@/lib/session';
import { createTemplate, deleteTemplate, syncTemplates, TemplateError } from '@wa/core';

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

/* ── Шаблоны WhatsApp ───────────────────────────────────────── */

export type TemplateResult = { ok: true; status: string } | { ok: false; error: string };

/** Создать шаблон и отправить на проверку в Meta. */
export async function createTemplateAction(input: { title: string; text: string; category: string; language: string }): Promise<TemplateResult> {
  const { db, user } = await requireCompany('settings:manage');
  try {
    const row = await createTemplate(db, {
      title: String(input.title ?? ''),
      text: String(input.text ?? ''),
      category: input.category === 'UTILITY' ? 'UTILITY' : 'MARKETING',
      language: input.language === 'kk' ? 'kk' : 'ru',
    });
    await db.auditLog.create({
      data: { action: 'template.created', actorUserId: user.id, entityType: 'MessageTemplate', entityId: row.id, metadata: { name: row.name } } as never,
    });
    revalidatePath('/settings');
    revalidatePath('/conversations');
    return { ok: true, status: row.status };
  } catch (error) {
    return { ok: false, error: error instanceof TemplateError ? error.message : 'Не удалось создать шаблон' };
  }
}

export async function deleteTemplateAction(id: string) {
  const { db } = await requireCompany('settings:manage');
  await deleteTemplate(db, String(id)).catch(() => {});
  revalidatePath('/settings');
  revalidatePath('/conversations');
}

/** Проверить статусы в Meta: одобрен или отклонён. */
export async function syncTemplatesAction(): Promise<{ ok: boolean; error?: string }> {
  const { db } = await requireCompany('settings:manage');
  try {
    await syncTemplates(db);
  } catch (error) {
    return { ok: false, error: error instanceof TemplateError ? error.message : 'Не удалось проверить статусы' };
  }
  revalidatePath('/settings');
  revalidatePath('/conversations');
  return { ok: true };
}
