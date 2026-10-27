'use client';

import { useActionState } from 'react';
import { adminCredit, adminSaveSettings, type AdminState } from '@/app/admin/actions';

/** Зачисление на баланс компании — одна строка в таблице компаний. */
export function CreditForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(adminCredit, null as AdminState);
  return (
    <form action={action} className="adm-credit">
      <input type="hidden" name="companyId" value={companyId} />
      <select name="kind" className="input" aria-label="Тип операции" defaultValue="topup">
        <option value="topup">Пополнение</option>
        <option value="bonus">Бонус</option>
        <option value="adjust">Корректировка ±</option>
      </select>
      <input name="amount" className="input" inputMode="decimal" placeholder="₸" aria-label="Сумма, ₸" required />
      <input name="note" className="input" placeholder="Заметка" aria-label="Заметка" style={{ width: 140 }} />
      XX
      {state?.ok && <span className="tiny adm-msg" style={{ color: 'var(--pine)' }}>{state.ok}</span>}
      {state?.error && <span className="tiny danger adm-msg">{state.error}</span>}
    </form>
  );
}

type Model = { id: string; label: string; inUsd: number; outUsd: number; baseIn: number; baseOut: number };

export function SettingsForm({
  settings,
  models,
}: {
  settings: { usdKzt: number; markup: number; welcomeBonusKzt: number; topupInstructions: string };
  models: Model[];
}) {
  const [state, action, pending] = useActionState(adminSaveSettings, null as AdminState);
  return (
    <form action={action}>
      {state?.error && <div className="notice notice-bad">{state.error}</div>}
      {state?.ok && <div className="notice notice-ok">{state.ok}</div>}
      <div className="adm-grid2">
        <label className="field">
          <span className="label">Курс доллара, ₸</span>
          <input className="input" name="usdKzt" inputMode="decimal" defaultValue={settings.usdKzt} />
        </label>
        <label className="field">
          <span className="label">Наценка, раз</span>
          <input className="input" name="markup" inputMode="decimal" defaultValue={settings.markup} />
          <span className="tiny muted">2 — клиент платит вдвое больше себестоимости</span>
        </label>
        <label className="field">
          <span className="label">Бонус новой компании, ₸</span>
          <input className="input" name="welcomeBonusKzt" inputMode="numeric" defaultValue={settings.welcomeBonusKzt} />
        </label>
      </div>
      <label className="field">
        <span className="label">Как клиенту оплатить — видят на странице «Баланс ИИ»</span>
        <textarea className="input" name="topupInstructions" rows={3} defaultValue={settings.topupInstructions} />
      </label>

      <span className="label">Себестоимость моделей, $ за 1 млн токенов (вход / выход)</span>
      <table style={{ marginBottom: 14, maxWidth: 560 }}>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td style={{ paddingLeft: 0 }}>{m.label}<div className="tiny muted">по умолчанию {m.baseIn} / {m.baseOut}</div></td>
              <td><input className="input" name={`in_${m.id}`} inputMode="decimal" defaultValue={m.inUsd} aria-label={`${m.label}: вход`} style={{ width: 90 }} /></td>
              <td style={{ paddingRight: 0 }}><input className="input" name={`out_${m.id}`} inputMode="decimal" defaultValue={m.outUsd} aria-label={`${m.label}: выход`} style={{ width: 90 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Сохраняю…' : 'Сохранить настройки'}</button>
    </form>
  );
}
