'use client';

import { useState, useTransition } from 'react';
import { createOrderHookAction, disableOrderHookAction, saveOrderStageMapAction } from '@/app/settings/actions';

/** Статусы заказа в складе (как в @wa/core SHOP_STATUS_LABEL; клиентский компонент сервер не тянет). */
const STATUSES: Array<[string, string]> = [
  ['draft', 'Новый (ждём оплату)'], ['paid', 'Оплачен'], ['assembled', 'Собран'], ['shipped', 'Отправлен'],
  ['completed', 'Выкуплен'], ['cancelled', 'Отменён'], ['returned', 'Возврат'],
];

/**
 * Связь со складом: склад присылает интернет-заказы, они привязываются
 * к клиентам WhatsApp по номеру, сделки двигаются сами.
 */
export function SkladOrdersSettings({ connected, lastAt, orders, linked, endpoint, stages, stageMap }: {
  connected: boolean; lastAt: string | null; orders: number; linked: number; endpoint: string;
  stages: { id: string; name: string }[]; stageMap: Record<string, string | null>;
}) {
  const [saved, setSaved] = useState(false);
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

      {connected && (
        <form
          action={(fd) => start(async () => { setSaved(false); await saveOrderStageMapAction(fd); setSaved(true); })}
          style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Куда двигать сделку</div>
          <p className="small muted" style={{ marginBottom: 12, maxWidth: '68ch' }}>
            Меняется статус заказа в складе — сделка клиента сама переходит на выбранный этап. Только вперёд: назад и из «Купил» не возвращаем.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) minmax(0, 260px)', gap: '8px 12px', alignItems: 'center' }}>
            {STATUSES.map(([st, label]) => (
              <label key={st} style={{ display: 'contents' }}>
                <span className="small">{label}</span>
                <select className="input" name={`st_${st}`} defaultValue={stageMap[st] ?? 'none'} onChange={() => setSaved(false)}>
                  <option value="none">— не менять этап —</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Сохраняю…' : 'Сохранить этапы'}</button>
            {saved && <span className="small muted">Сохранено. Чтобы подтянуть старые заказы — в складе нажмите «Отправить заказы за 30 дней».</span>}
          </div>
        </form>
      )}
    </section>
  );
}
