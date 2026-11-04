'use client';

import { useState } from 'react';
import { ConnectWhatsAppModal } from './ConnectWhatsAppModal';
import { ConnectNumberForm } from './ConnectNumberForm';

export function ConnectSection({ appId, configId }: { appId: string; configId: string }) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);

  const ready = Boolean(appId && configId);

  return (
    <>
      <div className="card card-p">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Подключить номер</div>
        <p className="small muted" style={{ marginBottom: 16 }}>
          Клиент входит в свой Business-аккаунт Meta и подтверждает доступ. Токен приходит
          напрямую от Meta — вводить его руками не нужно.
        </p>

        <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={!ready}>
          Подключить WhatsApp Business
        </button>

        {!ready && (
          <p className="hint" style={{ marginTop: 12 }}>
            Кнопка включится, когда на сервере будут заданы META_APP_ID и META_CONFIG_ID
            (ID конфигурации «Вход через Facebook для бизнеса» в приложении Meta). До этого —
            только ручное подключение номера, который уже работает через API.
          </p>
        )}

        <button className="btn btn-quiet btn-sm" style={{ marginTop: 14 }} onClick={() => setManual((v) => !v)}>
          {manual ? 'Скрыть ручное подключение' : 'Подключить вручную (свой WABA)'}
        </button>
      </div>

      {manual && <div style={{ marginTop: 16 }}><ConnectNumberForm /></div>}

      {open && <ConnectWhatsAppModal appId={appId} configId={configId} onClose={() => setOpen(false)} />}
    </>
  );
}
