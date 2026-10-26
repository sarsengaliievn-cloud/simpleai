'use client';

import { useActionState } from 'react';
import { register, type RegisterState } from '@/app/register/actions';

export function RegisterForm() {
  const [state, action, pending] = useActionState(register, null as RegisterState);
  const v = state?.values;
  // Меняется на каждый ответ с ошибкой — поля пересоздаются с введёнными значениями.
  const k = v ? JSON.stringify(v) : 'empty';

  return (
    <form action={action} key={k}>
      {state?.error && (
        <div className="chip chip-bad" style={{ height: 'auto', padding: '9px 12px', marginBottom: 14, display: 'block' }}>
          {state.error}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="field">
          <span className="label">Имя</span>
          <input className="input" name="firstName" autoComplete="given-name" defaultValue={v?.firstName} required />
        </label>
        <label className="field">
          <span className="label">Фамилия</span>
          <input className="input" name="lastName" autoComplete="family-name" defaultValue={v?.lastName} required />
        </label>
      </div>

      <label className="field">
        <span className="label">Рабочая почта</span>
        <input className="input" type="email" name="email" autoComplete="email" defaultValue={v?.email} required />
      </label>

      <label className="field">
        <span className="label">Телефон</span>
        <input className="input" name="phone" type="tel" autoComplete="tel" placeholder="+7 707 000 00 00" defaultValue={v?.phone} />
      </label>

      <label className="field">
        <span className="label">Компания</span>
        <input className="input" name="company" autoComplete="organization" defaultValue={v?.company} required />
        <span className="hint">Название увидят клиенты — его использует ассистент, когда представляется.</span>
      </label>

      <label className="field">
        <span className="label">Пароль</span>
        <input className="input" type="password" name="password" autoComplete="new-password" required minLength={8} />
        <span className="hint">Минимум 8 символов.</span>
      </label>

      <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={pending}>
        {pending ? 'Создаю…' : 'Создать аккаунт'}
      </button>
    </form>
  );
}
