'use server';

import { revalidatePath } from 'next/cache';
import { requireCompany } from '@/lib/session';

export async function saveAssistant(formData: FormData) {
  const { company, db } = await requireCompany();

  const data = {
    enabled: formData.get('enabled') === 'on',
    role: String(formData.get('role') ?? '').trim() || 'Консультант компании',
    tone: String(formData.get('tone') ?? 'Дружелюбный'),
    goals: String(formData.get('goals') ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
    languages: formData.getAll('languages').map(String),
    forbidden: String(formData.get('forbidden') ?? ''),
    extraRules: String(formData.get('extraRules') ?? ''),
    confidenceThreshold: Math.max(0, Math.min(100, Number(formData.get('threshold') ?? 70))),
    advancedMode: formData.get('advancedMode') === 'on',
    advancedPrompt: String(formData.get('advancedPrompt') ?? ''),
  };

  const existing = await db.aIConfiguration.findFirst();
  if (existing) {
    await db.aIConfiguration.updateMany({ where: { id: existing.id }, data });
  } else {
    await db.aIConfiguration.create({ data } as never);
  }

  await db.auditLog.create({
    data: { action: 'ai.config.updated', entityType: 'AIConfiguration', entityId: existing?.id ?? null } as never,
  });

  revalidatePath('/assistant');
  revalidatePath('/playground');
  return { ok: true as const, companyId: company.id };
}
