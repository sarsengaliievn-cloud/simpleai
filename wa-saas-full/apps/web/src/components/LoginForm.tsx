'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/app/login/actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null as LoginState);

  return (
    <form action={action}>
      {state?.error && (
        <div className="chip chip-bad" style={{ height: 'auto', padding: '9px 12px', marginBottom: 14, display: 'block' }}>
          {state.error}
        </div>
      )}

      <label className="field">
        <span className="label">Рабочая почта</span>
        {/* key заставляет React заново применить defaultValue после ответа сервера */}
        <input
          key={state?.email ?? ''}
          className="input"
          type="email"
          name="email"
          autoComplete="email"
          defaultValue={state?.email ?? ''}
          required
        />
      </label>

      <label className="field">
        <span className="label">Пароль</span>
        <input className="input" type="password" name="password" autoComplete="current-password" required autoFocus={Boolean(state?.email)} />
      </label>

      <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={pending}>
        {pending ? 'Вхожу…' : 'Войти'}
      </button>
    </form>
  );
}
