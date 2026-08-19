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
            Кнопка включится, когда в .env появятся META_APP_ID и META_CONFIG_ID. Их выдают
            после одобрения статуса Tech Provider — до этого момента подключение возможно
            только вручную.
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
