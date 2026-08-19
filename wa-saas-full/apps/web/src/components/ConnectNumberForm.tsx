'use client';

import { useState, useTransition } from 'react';
import { connectNumber } from '@/app/whatsapp/actions';

export function ConnectNumberForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="card card-p">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Подключить номер</div>
      <p className="small muted" style={{ marginBottom: 16 }}>
        Кнопки «Войти через Meta» здесь пока нет: она появляется только после одобрения
        статуса Tech Provider. Пока подключаем вручную — данные берутся в Meta Business Suite,
        раздел WhatsApp Manager.
      </p>

      {error && <div className="chip chip-bad" style={{ height: 'auto', padding: '7px 11px', marginBottom: 12 }}>{error}</div>}
      {done && <div className="chip chip-ok" style={{ height: 'auto', padding: '7px 11px', marginBottom: 12 }}>Номер сохранён</div>}

      <form
        action={(formData) => {
          setError(null); setDone(false);
          start(async () => {
            const result = await connectNumber(formData);
            if (result.ok) setDone(true);
            else setError(result.error);
          });
        }}
      >
        <label className="field">
          <span className="label">WhatsApp Business Account ID</span>
          <input className="input mono" name="wabaId" placeholder="104857392018477" />
        </label>
        <label className="field">
          <span className="label">Phone Number ID</span>
          <input className="input mono" name="phoneNumberId" placeholder="19283746501928" />
        </label>
        <label className="field">
          <span className="label">Номер для показа</span>
          <input className="input" name="displayPhoneNumber" placeholder="+7 707 000 00 00" />
        </label>
        <label className="field">
          <span className="label">Токен доступа</span>
          <input className="input mono" name="token" type="password" placeholder="EAAG..." />
          <span className="hint">Шифруется перед записью в базу и никогда не показывается целиком.</span>
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Сохраняю…' : 'Подключить'}
        </button>
      </form>
    </div>
  );
}
