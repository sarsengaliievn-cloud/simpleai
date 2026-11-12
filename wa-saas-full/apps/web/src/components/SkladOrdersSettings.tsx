'use client';

import { useState, useTransition } from 'react';
import { createOrderHookAction, disableOrderHookAction } from '@/app/settings/actions';

/**
 * Связь со складом: склад присылает интернет-заказы, они привязываются
 * к клиентам WhatsApp по номеру, сделки двигаются сами.
 */
export function SkladOrdersSettings({ connected, lastAt, orders, linked, endpoint }: {
  connected: boolean; lastAt: string | null; orders: number; linked: number; endpoint: string;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const create = () => start(async () => {
    setError(null); setCopied(false);
    const r = await createOrderHookAction();
    if (r.ok) setKey(r.key); else setError(r.error);
  });
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <section className="card card-p" style={{ marginBottom: 16 }} id="sklad">
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Склад: интернет-заказы</div>
      <p className="small muted" style={{ marginBottom: 14, maxWidth: '68ch' }}>
        Склад присылает каждый интернет-заказ и смену его статуса. По номеру телефона заказ попадает к клиенту в диалог,
        сделка сама переходит в «Заказ», «Выдан» или «Отказ», а ассистент отвечает клиенту, где его посылка.
        Записывать заказы в CRM вручную не нужно.
      </p>

      {connected ? (
        <div className="notice notice-ok">
          Подключено. {lastAt ? `Последний заказ пришёл ${lastAt}.` : 'Заказов ещё не было.'} Заказов: {orders}, привязано к клиентам WhatsApp: {linked}.
        </div>
      ) : (
        <div className="notice">Не подключено: создайте ключ и вставьте его в складе — «Настройки → SaudaBot».</div>
      )}
      {error && <div className="notice notice-bad">{error}</div>}

      {key && (
        <div className="notice notice-ok" style={{ display: 'grid', gap: 8 }}>
          <b>Ключ создан — скопируйте его сейчас, второй раз он не покажется.</b>
          <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{key}</code>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(key)}>{copied ? 'Скопировано' : 'Скопировать ключ'}</button>
          </div>
          <span className="small">Адрес для склада: <code style={{ userSelect: 'all' }}>{endpoint}</code></span>
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={create}>
          {pending ? 'Создаю…' : connected ? 'Создать новый ключ' : 'Создать ключ'}
        </button>
        {connected && (
          <button type="button" className="btn btn-quiet btn-sm" disabled={pending} onClick={() => start(async () => { await disableOrderHookAction(); setKey(null); })}>
            Отключить
          </button>
        )}
      </div>
      {connected && !key && <p className="tiny muted" style={{ marginTop: 8 }}>Новый ключ сразу отключает старый — его придётся заменить и в складе.</p>}
    </section>
  );
}
