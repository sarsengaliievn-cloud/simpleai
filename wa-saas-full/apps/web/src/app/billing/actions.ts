'use server';

import { revalidatePath } from 'next/cache';
import { requireCompany } from '@/lib/session';

export type TopupState = { ok?: string; error?: string } | null;

/** Заявка на пополнение — владелец платформы видит её в админке и зачисляет. */
export async function requestTopup(_prev: TopupState, formData: FormData): Promise<TopupState> {
  const { db, user } = await requireCompany('settings:manage');
  const amount = Number.parseInt(String(formData.get('amount') ?? '').replace(/\D/g, ''), 10);
  const comment = String(formData.get('comment') ?? '').trim().slice(0, 500);
  if (!Number.isFinite(amount) || amount < 1000) return { error: 'Минимальная сумма — 1 000 ₸' };
  if (amount > 5_000_000) return { error: 'Слишком большая сумма — напишите нам напрямую' };

  const open = await db.topupRequest.count({ where: { status: 'open' } });
  if (open >= 3) return { error: 'У вас уже есть заявки в работе — дождитесь зачисления' };

  await db.topupRequest.create({ data: { amountTiyn: amount * 100, comment: comment || null, requestedBy: user.id } as never });
  revalidatePath('/billing');
  return { ok: 'Заявка отправлена. Баланс пополнится после проверки оплаты.' };
}
