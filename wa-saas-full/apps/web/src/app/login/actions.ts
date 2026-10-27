'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@wa/db';
import {
  verifyPasswordOrDummy,
  createSession,
  destroySession,
  loginLockedFor,
  registerLoginFailure,
  resetLoginFailures,
} from '@/lib/auth';

export type LoginState = { error?: string; email?: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  // Почту возвращаем в форму: React 19 очищает поля после отправки,
  // и без этого после опечатки в пароле приходится набирать всё заново.
  const locked = loginLockedFor(email);
  if (locked) {
    return { email, error: `Слишком много попыток. Повторите через ${Math.ceil(locked / 60)} мин.` };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Один и тот же текст и одинаковое время ответа на неверную почту и
  // неверный пароль — иначе форма превращается в способ узнать, кто
  // зарегистрирован.
  const valid = await verifyPasswordOrDummy(password, user?.passwordHash);
  if (!user || !valid) {
    registerLoginFailure(email);
    return { email, error: 'Неверная почта или пароль' };
  }

  resetLoginFailures(email);

  // Владелец убрал сотрудника из команды — пароль верный, но работать не с чем.
  const membership = await prisma.membership.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (!membership) {
    return { email, error: 'Доступ к компании закрыт. Обратитесь к владельцу аккаунта.' };
  }

  const h = await headers();
  await createSession(user.id, {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: h.get('user-agent')?.slice(0, 300) ?? undefined,
  });
  redirect('/conversations');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}
