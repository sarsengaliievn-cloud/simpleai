import { notFound } from 'next/navigation';
import { getSessionUser } from './auth';

/** Почты владельцев платформы из SUPER_ADMIN_EMAILS (через запятую). */
export function superAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdmin(email: string | null | undefined) {
  return Boolean(email) && superAdminEmails().includes(email!.toLowerCase());
}

/**
 * Вход в админку платформы. Чужим — 404, а не редирект: так никто не
 * узнает, что такой раздел вообще есть.
 */
export async function requireSuperAdmin() {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user.email)) notFound();
  return user;
}
