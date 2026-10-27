'use client';

import { useActionState, useState } from 'react';
import { addMember, resetMemberPassword, type MemberState } from '@/app/team/actions';

function Notice({ state }: { state: MemberState }) {
  if (!state) return null;
  return state.error
    ? <div className="notice notice-bad">{state.error}</div>
    : state.ok ? <div className="notice notice-ok">{state.ok}</div> : null;
}

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMember, null as MemberState);
  const v = state?.values ?? {};
  // После успешного добавления форма очищается — новый ключ пересоздаёт поля.
  const key = state?.ok ?? 'form';

  return (
    <form action={action} key={key}>
      <Notice state={state} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <label className="field"><span className="label">Имя</span><input className="input" name="firstName" defaultValue={v.firstName} required /></label>
        <label className="field"><span className="label">Фамилия</span><input className="input" name="lastName" defaultValue={v.lastName} /></label>
        <label className="field"><span className="label">Почта для входа</span><input className="input" type="email" name="email" defaultValue={v.email} required /></label>
        <label className="field"><span className="label">Пароль</span><input className="input" name="password" minLength={8} required placeholder="не короче 8 символов" /></label>
      </div>
      <label className="field" style={{ maxWidth: 300 }}>
        <span className="label">Роль</span>
        <select className="select" name="role" defaultValue={v.role ?? 'MANAGER'}>
          <option value="MANAGER">Менеджер — только свои клиенты</option>
          <option value="ADMIN">Администратор — всё</option>
        </select>
      </label>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Добавляю…' : 'Добавить в команду'}</button>
    </form>
  );
}

export function ResetPasswordForm({ membershipId, name }: { membershipId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(resetMemberPassword, null as MemberState);

  if (!open) {
    return <button className="btn btn-quiet btn-sm" type="button" onClick={() => setOpen(true)}>Новый пароль</button>;
  }
  return (
    <form action={action} className="row" style={{ gap: 6 }}>
      <input type="hidden" name="membershipId" value={membershipId} />
      {state?.ok ? (
        <span className="tiny" style={{ color: 'var(--pine-600)', fontWeight: 600 }}>{state.ok}</span>
      ) : (
        <>
          <input className="input" style={{ height: 32, width: 160 }} name="password" minLength={8} placeholder={`пароль для ${name}`} required autoFocus />
          <button className="btn btn-ghost btn-sm" type="submit" disabled={pending}>Сохранить</button>
          {state?.error && <span className="tiny" style={{ color: 'var(--red)' }}>{state.error}</span>}
        </>
      )}
    </form>
  );
}
