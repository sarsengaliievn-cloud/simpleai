import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { RegisterForm } from '@/components/RegisterForm';

export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect('/conversations');

  return (
    <div className="auth">
      <div className="auth-card">
        <Link href="/" className="logo" style={{ marginBottom: 26 }}>
          <span className="logo-mark" />
          SaudaBot
        </Link>
        <div className="card card-p" style={{ padding: 28 }}>
          <h1>Создать аккаунт</h1>
          <p className="small muted" style={{ marginBottom: 24 }}>
            14 дней бесплатно, карта не нужна.
          </p>
          <RegisterForm />
          <p className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>
            Уже есть аккаунт?{' '}
            <Link href="/login" style={{ color: 'var(--pine)', fontWeight: 600 }}>
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
