'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@wa/db';
import { requireCompany } from '@/lib/session';
import { hashPassword } from '@/lib/auth';

export type MemberState = { ok?: string; error?: string; values?: Record<string, string> } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES = ['MANAGER', 'ADMIN'] as const;

/**
 * Добавить сотрудника: владелец сам задаёт почту и пароль и передаёт их
 * менеджеру. Писем и приглашений нет — так проще и надёжнее на старте.
 */
export async function addMember(_prev: MemberState, formData: FormData): Promise<MemberState> {
  const { db, user, company } = await requireCompany('team:manage');

  const values = {
    firstName: String(formData.get('firstName') ?? '').trim().slice(0, 80),
    lastName: String(formData.get('lastName') ?? '').trim().slice(0, 80),
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    role: String(formData.get('role') ?? 'MANAGER'),
  };
  const password = String(formData.get('password') ?? '');
  const fail = (error: string): MemberState => ({ error, values });

  if (!values.firstName || !values.email) return fail('Укажите имя и почту');
  if (!EMAIL_RE.test(values.email)) return fail('Проверьте адрес почты');
  if (password.length < 8) return fail('Пароль — не короче 8 символов');
  if (!ROLES.includes(values.role as (typeof ROLES)[number])) return fail('Неизвестная роль');

  const exists = await prisma.user.findUnique({ where: { email: values.email }, select: { id: true } });
  if (exists) return fail('Эта почта уже используется в SaudaBot. Укажите другую.');

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: values.email,
          firstName: values.firstName,
          lastName: values.lastName,
          passwordHash: await hashPassword(password),
        },
      });
      await tx.membership.create({
        data: { userId: created.id, companyId: company.id, role: values.role as 'MANAGER' | 'ADMIN' },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return fail('Эта почта уже используется в SaudaBot. Укажите другую.');
    throw error;
  }

  await db.auditLog.create({
    data: { actorUserId: user.id, action: 'team.member.added', entityType: 'User', metadata: { email: values.email, role: values.role } } as never,
  });

  revalidatePath('/team');
  return { ok: `${values.firstName} добавлен. Передайте ему почту ${values.email} и пароль — вход на странице входа.` };
}

/** Убрать из команды: вход закрывается сразу, клиенты остаются за ним, пока их не передадут. */
export async function removeMember(membershipId: string) {
  const { db, user } = await requireCompany('team:manage');
  const member = await db.membership.findFirst({ where: { id: membershipId } });
  if (!member || member.role === 'OWNER' || member.userId === user.id) return;

  await db.membership.deleteMany({ where: { id: member.id } });
  await prisma.session.deleteMany({ where: { userId: member.userId } });
  await db.auditLog.create({
    data: { actorUserId: user.id, action: 'team.member.removed', entityType: 'User', entityId: member.userId } as never,
  });
  revalidatePath('/team');
}

/** Новый пароль сотруднику — если забыл. Все его входы закрываются. */
export async function resetMemberPassword(_prev: MemberState, formData: FormData): Promise<MemberState> {
  const { db, user } = await requireCompany('team:manage');
  const membershipId = String(formData.get('membershipId') ?? '');
  const password = String(formData.get('password') ?? '');
  if (password.length < 8) return { error: 'Пароль — не короче 8 символов' };

  const member = await db.membership.findFirst({ where: { id: membershipId }, include: { user: true } });
  if (!member || member.role === 'OWNER') return { error: 'Сотрудник не найден' };

  await prisma.user.update({ where: { id: member.userId }, data: { passwordHash: await hashPassword(password) } });
  await prisma.session.deleteMany({ where: { userId: member.userId } });
  await db.auditLog.create({
    data: { actorUserId: user.id, action: 'team.member.password', entityType: 'User', entityId: member.userId } as never,
  });
  return { ok: `Пароль для ${member.user.firstName} изменён` };
}
