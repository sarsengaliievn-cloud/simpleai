'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@wa/db';
import { autoAssignConversation, CLOSED_KINDS } from '@wa/core';
import { requireCompany } from '@/lib/session';

/** Сколько ждущих клиентов разбирается при начале смены. */
const PICKUP_LIMIT = 20;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Начать смену: менеджер в очереди на новых клиентов. Заодно разбираем
 * клиентов, которые ждали, пока на смене никого не было (ночь, утро).
 */
export async function startShiftAction() {
  const ctx = await requireCompany();
  const now = new Date();
  await prisma.membership.update({
    where: { id: ctx.membership.id },
    data: { onShift: true, shiftStartedAt: now, lastSeenAt: now },
  });

  let picked = 0;
  if (ctx.company.autoAssign) {
    // Ждут менеджера: бот отдал диалог, или бот выключен совсем.
    const ai = await ctx.db.aIConfiguration.findFirst({ select: { enabled: true } });
    const waiting = await ctx.db.deal.findMany({
      where: {
        assigneeId: null,
        archivedAt: null,
        stage: { kind: { notIn: CLOSED_KINDS } },
        conversation: {
          lastMessageAt: { gte: new Date(now.getTime() - DAY) },
          ...(ai?.enabled ? { mode: 'HUMAN' as const } : {}),
        },
      },
      orderBy: { createdAt: 'asc' },
      take: PICKUP_LIMIT,
      select: { conversationId: true },
    });
    for (const d of waiting) {
      if (!d.conversationId) continue;
      const r = await autoAssignConversation(ctx.db, { companyId: ctx.company.id, conversationId: d.conversationId }).catch(() => null);
      if (r) picked += 1;
    }
  }
  revalidatePath('/', 'layout');
  return { picked };
}

export async function endShiftAction() {
  const ctx = await requireCompany();
  await prisma.membership.update({ where: { id: ctx.membership.id }, data: { onShift: false } });
  revalidatePath('/', 'layout');
}

/** Панель открыта — менеджер на месте. Вызывается раз в пару минут, пока идёт смена. */
export async function pingShiftAction() {
  const ctx = await requireCompany();
  if (!ctx.membership.onShift) return { onShift: false };
  await prisma.membership.update({ where: { id: ctx.membership.id }, data: { lastSeenAt: new Date() } });
  return { onShift: true };
}

/** Включить или выключить авто-распределение. Владелец или администратор. */
export async function setAutoAssignAction(on: boolean) {
  const ctx = await requireCompany('team:manage');
  await prisma.company.update({ where: { id: ctx.company.id }, data: { autoAssign: on } });
  revalidatePath('/', 'layout');
}
