import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { prisma } from '@wa/db';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const COOKIE = 'wa_session';
const SESSION_DAYS = 30;

/* ── Пароли ──────────────────────────────────────────────────
   scrypt из стандартной библиотеки Node: без лишней зависимости
   и устойчив к перебору на видеокартах.
   ──────────────────────────────────────────────────────────── */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

/**
 * Хеш-пустышка для несуществующей почты: scrypt считается в любом случае,
 * иначе по времени ответа видно, зарегистрирован ли адрес.
 */
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

export async function verifyPasswordOrDummy(password: string, stored: string | null | undefined) {
  const ok = await verifyPassword(password, stored ?? DUMMY_HASH);
  return Boolean(stored) && ok;
}

/* ── Защита от перебора ────────────────────────────────────────
   Счётчик в памяти процесса: веб-сервер у нас один. Если появится
   несколько инстансов — перенести в Redis тем же интерфейсом.
   ──────────────────────────────────────────────────────────── */

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; until: number }>();

/** Сколько секунд ещё заблокирован вход для этой почты, 0 — можно. */
export function loginLockedFor(email: string): number {
  const entry = fails.get(email);
  if (!entry) return 0;
  if (entry.until && entry.until > Date.now()) return Math.ceil((entry.until - Date.now()) / 1000);
  if (entry.until && entry.until <= Date.now()) fails.delete(email);
  return 0;
}

export function registerLoginFailure(email: string) {
  const entry = fails.get(email) ?? { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILS) {
    entry.until = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  fails.set(email, entry);
  // Не даём карте расти бесконечно от перебора случайных адресов.
  if (fails.size > 10_000) fails.clear();
}

export function resetLoginFailures(email: string) {
  fails.delete(email);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const derived = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');

  // Сравнение постоянного времени: обычное === выдаёт длину совпадения
  // по времени ответа.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/* ── Сессии ─────────────────────────────────────────────────── */

export async function createSession(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId, sessionToken: token, expiresAt, ip: meta?.ip ?? null, userAgent: meta?.userAgent ?? null },
  });

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

/** Пользователь текущей сессии или null. Просроченные сессии подчищаются. */
export async function getSessionUser() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session.user;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { sessionToken: token } });
  }
  store.delete(COOKIE);
}

export const SESSION_COOKIE = COOKIE;
