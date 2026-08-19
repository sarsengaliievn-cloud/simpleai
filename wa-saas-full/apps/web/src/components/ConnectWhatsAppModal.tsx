'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { checkNumber, completeEmbeddedSignup } from '@/app/whatsapp/actions';

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (cb: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type Step = 'check' | 'ready' | 'connecting' | 'done';

export function ConnectWhatsAppModal({
  appId,
  configId,
  onClose,
}: {
  appId: string;
  configId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<Step>('check');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // Данные из окна Meta приходят отдельным сообщением, а код — в колбэке
  // FB.login. Оба нужны одновременно, поэтому храним промежуточно.
  const [session, setSession] = useState<{ wabaId: string; phoneNumberId: string } | null>(null);

  useEffect(() => {
    if (window.FB) { setSdkReady(true); return; }

    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: true, version: 'v24.0' });
      setSdkReady(true);
    };

    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, [appId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const data = JSON.parse(event.data as string) as {
          type?: string;
          event?: string;
          data?: { waba_id?: string; phone_number_id?: string };
          error_message?: string;
        };
        if (data.type !== 'WA_EMBEDDED_SIGNUP') return;

        if (data.event === 'FINISH' && data.data?.waba_id && data.data.phone_number_id) {
          setSession({ wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id });
        } else if (data.event === 'CANCEL') {
          setError('Подключение отменено в окне Meta');
          setStep('ready');
        } else if (data.error_message) {
          setError(data.error_message);
          setStep('ready');
        }
      } catch {
        // Не наше сообщение — Facebook шлёт в это окно и служебные события.
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const runCheck = async () => {
    setBusy(true); setError(null); setNote(null);
    const result = await checkNumber(phone);
    setBusy(false);

    if (!result.ok) { setError(result.error); return; }
    setPhone(result.normalized);
    setNote(result.note);
    setStep('ready');
  };

  const finish = useCallback(
    async (code: string, wabaId: string, phoneNumberId: string) => {
      const result = await completeEmbeddedSignup({ code, wabaId, phoneNumberId });
      if (result.ok) { setStep('done'); router.refresh(); }
      else { setError(result.error); setStep('ready'); }
    },
    [router],
  );

  const launch = () => {
    if (!window.FB) { setError('Не загрузился скрипт Meta. Проверьте, не блокирует ли его расширение браузера.'); return; }
    if (!configId) { setError('В .env не задан META_CONFIG_ID — его выдают после одобрения Tech Provider.'); return; }

    setError(null);
    setStep('connecting');

    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) { setError('Meta не вернула код авторизации'); setStep('ready'); return; }
        if (!session) { setError('Meta не передала данные аккаунта. Попробуйте ещё раз.'); setStep('ready'); return; }
        void finish(code, session.wabaId, session.phoneNumberId);
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      },
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(18,22,28,.45)', display: 'grid', placeItems: 'center', zIndex: 100 }} onClick={onClose}>
      <div className="card card-p" style={{ width: 'min(440px, 92vw)', padding: 26 }} onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Подключение WhatsApp</div>
          <button className="btn btn-quiet btn-sm" onClick={onClose}>✕</button>
        </div>

        {step === 'done' ? (
          <>
            <p className="small muted" style={{ margin: '10px 0 18px' }}>
              Номер подключён. Входящие сообщения появятся в разделе «Диалоги».
            </p>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>Готово</button>
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: '6px 0 18px' }}>
              Введите номер WhatsApp, который планируете подключить.
            </p>

            <div className="row" style={{ marginBottom: 12 }}>
              <input
                className="input"
                placeholder="+7 XXX XXX XXXX"
                value={phone}
                disabled={step !== 'check'}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && step === 'check' && runCheck()}
              />
              <button className="btn btn-primary" onClick={runCheck} disabled={busy || step !== 'check' || !phone.trim()}>
                {busy ? '…' : 'Проверить'}
              </button>
            </div>

            {error && (
              <div className="chip chip-bad" style={{ height: 'auto', padding: '9px 12px', marginBottom: 12, display: 'block' }}>
                {error}
              </div>
            )}

            {step !== 'check' && !error && (
              <div className="chip chip-ok" style={{ height: 'auto', padding: '9px 12px', marginBottom: 12, display: 'block' }}>
                Номер свободен. Можете продолжить подключение.
              </div>
            )}

            {note && <p className="hint" style={{ marginBottom: 16 }}>{note}</p>}

            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={launch}
              disabled={step !== 'ready' || !sdkReady}
            >
              {step === 'connecting' ? 'Открываю окно Meta…' : 'Продолжить подключение'}
            </button>

            <p className="hint" style={{ marginTop: 12 }}>
              Откроется окно Meta — вход в ваш Business-аккаунт и подтверждение доступа.
              Токен придёт напрямую от Meta, вводить его руками не нужно.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
