'use client';

import { useState, useTransition } from 'react';
import { connectNumber } from '@/app/whatsapp/actions';

export function ConnectNumberForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="card card-p">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Подключить номер</div>
      <p className="small muted" style={{ marginBottom: 16 }}>
        Для своего номера: WABA ID и Phone Number ID — в приложении Meta, раздел
        WhatsApp → API Setup. Токен — <b>постоянный</b>, от System User в Business Settings
        (временный из API Setup живёт 24 часа). Платформа проверит номер в Meta и сама
        подпишет его на входящие сообщения.
      </p>

      {error && <div className="chip chip-bad" style={{ height: 'auto', padding: '7px 11px', marginBottom: 12 }}>{error}</div>}
      {done && <div className="chip chip-ok" style={{ height: 'auto', padding: '7px 11px', marginBottom: 12 }}>{done}</div>}

      {/* onSubmit, а не action: React 19 очищает форму после action, и при
          ошибке в одном поле пропадали все остальные, включая токен. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const formData = new FormData(form);
          setError(null); setDone(null);
          start(async () => {
            const result = await connectNumber(formData).catch(() => ({ ok: false as const, error: 'Не удалось связаться с сервером. Попробуйте ещё раз.' }));
            if (result.ok) {
              const name = 'verifiedName' in result && result.verifiedName ? ` (${result.verifiedName})` : '';
              setDone(`Номер ${'display' in result ? result.display : ''}${name} подключён — входящие сообщения пойдут в «Диалоги».`);
              form.reset();
            } else setError(result.error);
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
          <span className="hint">Можно оставить пустым — номер подтянется из Meta.</span>
        </label>
        <label className="field">
          <span className="label">Токен доступа</span>
          <input className="input mono" name="token" type="password" placeholder="EAAG..." />
          <span className="hint">Шифруется перед записью в базу и никогда не показывается целиком.</span>
        </label>
        <label className="field">
          <span className="label">PIN двухэтапной проверки (необязательно)</span>
          <input className="input mono" name="pin" inputMode="numeric" maxLength={6} placeholder="6 цифр" />
          <span className="hint">Нужен один раз, если номер ещё не зарегистрирован в Cloud API. Придумайте и сохраните — Meta спросит его при переносе номера.</span>
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Проверяю в Meta…' : 'Подключить'}
        </button>
      </form>
    </div>
  );
}
