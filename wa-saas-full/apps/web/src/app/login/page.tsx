import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@wa/db';
import { getCurrentUser } from '@/lib/session';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const current = await getCurrentUser();
  // Без членства в компании (убран из команды) — не уводим в панель:
  // оттуда его вернуло бы сюда же, и страница крутилась бы по кругу.
  const member = current && (await prisma.membership.findFirst({ where: { userId: current.id }, select: { id: true } }));
  if (member) redirect('/conversations');

  return (
    <div className="auth">
      <div className="auth-card">
        <Link href="/" className="logo" style={{ marginBottom: 26 }}>
          <span className="logo-mark" />
          SaudaBot
        </Link>
        <div className="card card-p" style={{ padding: 28 }}>
          <h1>С возвращением</h1>
          <p className="small muted" style={{ marginBottom: 24 }}>
            Войдите, чтобы вернуться к диалогам.
          </p>
          <LoginForm />
          <p className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>
            Нет аккаунта?{' '}
            <Link href="/register" style={{ color: 'var(--pine)', fontWeight: 600 }}>
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
