'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@wa/db';
import { creditBalance, saveBillingSettings, MODELS } from '@wa/core';
import { requireSuperAdmin } from '@/lib/admin';

export type AdminState = { ok?: string; error?: string } | null;

function kzt(value: FormDataEntryValue | null) {
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Пополнение или корректировка баланса компании вручную. */
export async function adminCredit(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const admin = await requireSuperAdmin();
  const companyId = String(formData.get('companyId') ?? '');
  const kind = String(formData.get('kind') ?? 'topup');
  const amount = kzt(formData.get('amount'));
  const note = String(formData.get('note') ?? '').trim().slice(0, 300) || null;

  if (!['topup', 'bonus', 'adjust'].includes(kind)) return { error: 'Неизвестный тип операции' };
  if (!Number.isFinite(amount) || amount === 0) return { error: 'Укажите сумму' };
  if (kind !== 'adjust' && amount < 0) return { error: 'Списание — через «Корректировку»' };
  if (Math.abs(amount) > 10_000_000) return { error: 'Слишком большая сумма' };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company) return { error: 'Компания не найдена' };

  await creditBalance(company.id, { kind: kind as 'topup' | 'bonus' | 'adjust', amountTiyn: Math.round(amount * 100), note, actorEmail: admin.email });
  revalidatePath('/admin');
  return { ok: `${company.name}: ${amount > 0 ? '+' : ''}${amount} ₸` };
}

/** Заявку одобрили — зачисляем сумму и закрываем; отклонили — только закрываем. */
export async function resolveTopup(formData: FormData) {
  const admin = await requireSuperAdmin();
  const id = String(formData.get('id') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (decision !== 'approve' && decision !== 'reject') return;
  const request = await prisma.topupRequest.findUnique({ where: { id } });
  if (!request || request.status !== 'open') return;

  // Сначала закрываем заявку условным апдейтом — двойной клик не зачислит дважды.
  const closed = await prisma.topupRequest.updateMany({
    where: { id, status: 'open' },
    data: { status: decision === 'approve' ? 'done' : 'rejected', resolvedAt: new Date() },
  });
  if (closed.count === 1 && decision === 'approve') {
    await creditBalance(request.companyId, {
      kind: 'topup',
      amountTiyn: request.amountTiyn,
      note: request.comment ? `По заявке: ${request.comment}` : 'По заявке на пополнение',
      actorEmail: admin.email,
    });
  }
  revalidatePath('/admin');
}

export async function adminSaveSettings(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireSuperAdmin();
  const usdKzt = kzt(formData.get('usdKzt'));
  const markup = kzt(formData.get('markup'));
  const welcomeBonusKzt = kzt(formData.get('welcomeBonusKzt'));
  const topupInstructions = String(formData.get('topupInstructions') ?? '').trim().slice(0, 2000);

  if (!(usdKzt >= 100 && usdKzt <= 2000)) return { error: 'Курс доллара — от 100 до 2000 ₸' };
  if (!(markup >= 1 && markup <= 20)) return { error: 'Наценка — от 1 (без наценки) до 20' };
  if (!(welcomeBonusKzt >= 0 && welcomeBonusKzt <= 100_000)) return { error: 'Бонус новой компании — от 0 до 100 000 ₸' };
  if (!topupInstructions) return { error: 'Напишите, как клиенту оплатить' };

  const prices: Record<string, { inUsd: number; outUsd: number }> = {};
  for (const m of MODELS) {
    const inUsd = kzt(formData.get(`in_${m.id}`));
    const outUsd = kzt(formData.get(`out_${m.id}`));
    if (!(inUsd >= 0) || !(outUsd >= 0)) return { error: `Цена модели ${m.label} указана неверно` };
    if (inUsd !== m.inUsd || outUsd !== m.outUsd) prices[m.id] = { inUsd, outUsd };
  }

  await saveBillingSettings({ usdKzt, markup, welcomeBonusKzt, topupInstructions, prices });
  revalidatePath('/admin');
  return { ok: 'Сохранено. Новые цены начнут действовать в течение минуты.' };
}
