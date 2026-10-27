'use client';

import { useActionState, useState } from 'react';
import { requestTopup, type TopupState } from '@/app/billing/actions';

const PRESETS = [5000, 10000, 20000, 50000];

export function TopupForm() {
  const [state, action, pending] = useActionState(requestTopup, null as TopupState);
  const [amount, setAmount] = useState('10000');

  return (
    <form action={action} key={state?.ok ?? 'form'}>
      {state?.error && <div className="notice notice-bad">{state.error}</div>}
      {state?.ok && <div className="notice notice-ok">{state.ok}</div>}
      <span className="label">Сумма, ₸</span>
      <div className="reason-chips">
        {PRESETS.map((p) => (
          <button key={p} type="button" className={`chip chip-btn ${amount === String(p) ? 'chip-on' : ''}`} onClick={() => setAmount(String(p))}>
            {new Intl.NumberFormat('ru-RU').format(p).replace(/[  ]/g, ' ')} ₸
          </button>
        ))}
      </div>
      <input className="input" name="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 220, marginBottom: 12 }} aria-label="Сумма пополнения" />
      <label className="field">
        <span className="label">Комментарий</span>
        <input className="input" name="comment" placeholder="Например: оплатил на Kaspi с номера +7 …" />
      </label>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Отправляю…' : 'Запросить пополнение'}</button>
    </form>
  );
}
