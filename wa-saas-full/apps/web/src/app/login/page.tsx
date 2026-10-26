import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/conversations');

  return (
    <div className="auth">
      <div className="auth-card">
        <Link href="/" className="logo" style={{ marginBottom: 26 }}>
          <span className="logo-mark" />
          Zerde
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
