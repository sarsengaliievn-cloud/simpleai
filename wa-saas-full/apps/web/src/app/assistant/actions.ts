'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCompany } from '@/lib/session';

const TONES = ['Дружелюбный', 'Профессиональный', 'Короткий', 'Подробный', 'Формальный'];
const LANGS = ['ru', 'kk', 'en'];

/**
 * Обработчик формы обязан возвращать void — иначе `next build` падает
 * на проверке типов. Результат сообщаем через ?saved=1 в адресе.
 */
export async function saveAssistant(formData: FormData): Promise<void> {
  const { db, user } = await requireCompany();

  const threshold = Number.parseInt(String(formData.get('threshold') ?? ''), 10);
  const tone = String(formData.get('tone') ?? '');
  const languages = formData.getAll('languages').map(String).filter((l) => LANGS.includes(l));

  const data = {
    enabled: formData.get('enabled') === 'on',
    role: String(formData.get('role') ?? '').trim().slice(0, 200) || 'Консультант компании',
    tone: TONES.includes(tone) ? tone : 'Дружелюбный',
    goals: String(formData.get('goals') ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20),
    // Без языков инструкция получала бы «отвечай на языке клиента ()».
    languages: languages.length ? languages : ['ru'],
    forbidden: String(formData.get('forbidden') ?? '').slice(0, 4000),
    extraRules: String(formData.get('extraRules') ?? '').slice(0, 4000),
    // Пустое поле или мусор — оставляем разумное значение, а не 0
    // (0 означал бы «отвечать всегда, даже без опоры на базу»).
    confidenceThreshold: Number.isFinite(threshold) ? Math.max(0, Math.min(100, threshold)) : 70,
    advancedMode: formData.get('advancedMode') === 'on',
    advancedPrompt: String(formData.get('advancedPrompt') ?? '').slice(0, 20000),
  };

  const existing = await db.aIConfiguration.findFirst();
  if (existing) {
    await db.aIConfiguration.updateMany({ where: { id: existing.id }, data });
  } else {
    await db.aIConfiguration.create({ data } as never);
  }

  await db.auditLog.create({
    data: {
      action: 'ai.config.updated',
      actorUserId: user.id,
      entityType: 'AIConfiguration',
      entityId: existing?.id ?? null,
      metadata: { enabled: data.enabled, threshold: data.confidenceThreshold },
    } as never,
  });

  revalidatePath('/assistant');
  revalidatePath('/playground');
  redirect('/assistant?saved=1');
}
