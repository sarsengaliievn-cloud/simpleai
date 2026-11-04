import type { Role, TenantClient } from '@wa/db';

export type ShellCtx = {
  company: { name: string; balanceTiyn: number; lastTopupTiyn: number; billingExempt?: boolean; aiError?: string | null; autoAssign?: boolean };
  user: { id?: string; firstName: string; lastName: string; email?: string };
  role: Role;
  membership?: { onShift: boolean; shiftStartedAt: Date | null };
  db?: TenantClient;
  seesOnlyOwn?: boolean;
};

const RECEIVES_CLIENTS: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'];

/** Сколько напоминаний уже пора выполнить: менеджеру — по своим, владельцу — по своим и ничьим. */
async function dueReminders(ctx: ShellCtx) {
  if (!ctx.db || !ctx.user.id) return 0;
  try {
    return await ctx.db.deal.count({
      where: {
        remindAt: { lte: new Date() },
        ...(ctx.seesOnlyOwn ? { assigneeId: ctx.user.id } : { OR: [{ assigneeId: ctx.user.id }, { assigneeId: null }] }),
      },
    });
  } catch {
    return 0;
  }
}

/** Смена и напоминания для меню — одинаково на всех страницах. */
export async function sidebarExtras(ctx: ShellCtx) {
  const shift =
    ctx.company.autoAssign && ctx.membership && RECEIVES_CLIENTS.includes(ctx.role)
      ? { onShift: ctx.membership.onShift, startedAt: ctx.membership.shiftStartedAt?.toISOString() ?? null }
      : null;
  return { shift, dueReminders: await dueReminders(ctx) };
}
