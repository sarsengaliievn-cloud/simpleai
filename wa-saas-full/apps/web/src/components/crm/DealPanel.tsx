'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  moveDealAction,
  assignDealAction,
  updateDealAction,
  addDealNoteAction,
  setReminderAction,
  restoreDealAction,
  type DealResult,
} from '@/app/deals/actions';
import type { DealView, MemberView, StageView } from '@/lib/crm';
import { money, clockWithDay, since } from '@/lib/format';
import { OrderForm, LostForm } from './StageForms';

type Mode =
  | { kind: 'idle' }
  | { kind: 'order'; stageId: string }
  | { kind: 'won'; stageId: string }
  | { kind: 'lost'; stageId: string }
  | { kind: 'edit' };

/**
 * Карточка сделки: этап, менеджер, заказ, история. Этапы показаны нитью —
 * той же, что в диалоге: видно, где клиент сейчас и что уже пройдено.
 */
export function DealPanel({
  deal,
  stages,
  members,
  lostReasons,
  showDialogLink = false,
}: {
  deal: DealView;
  stages: StageView[];
  /** null — пользователь не может передавать клиентов (менеджер). */
  members: MemberView[] | null;
  lostReasons: string[];
  showDialogLink?: boolean;
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();

  const current = stages.find((s) => s.id === deal.stageId);
  const currentIndex = stages.findIndex((s) => s.id === deal.stageId);
  // Ближайший заказ и «купил» после текущего этапа, если есть, иначе первые по списку.
  const after = (kind: StageView['kind']) =>
    stages.find((s, i) => s.kind === kind && i > currentIndex) ?? stages.find((s) => s.kind === kind);
  const orderStage = after('ORDER');
  const wonStage = after('WON');
  const lostStages = stages.filter((s) => s.kind === 'LOST');

  const run = (fn: () => Promise<DealResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      else {
        setMode({ kind: 'idle' });
        after?.();
      }
    });
  };

  const pick = (stage: StageView) => {
    if (stage.id === deal.stageId && stage.kind !== 'ORDER') return;
    if (stage.kind === 'ORDER' && (!deal.amount || !deal.product || stage.id === deal.stageId)) return setMode({ kind: 'order', stageId: stage.id });
    if (stage.kind === 'WON' && !deal.amount) return setMode({ kind: 'won', stageId: stage.id });
    if (stage.kind === 'LOST') return setMode({ kind: 'lost', stageId: stage.id });
    run(() => moveDealAction(deal.id, stage.id));
  };

  return (
    <div className="deal">
      <div className="deal-head">
        <div style={{ minWidth: 0 }}>
          <div className="deal-name">{deal.customer.name}</div>
          <div className="tiny muted">
            {deal.customer.phone}
            {deal.customer.city ? `, ${deal.customer.city}` : ''}
          </div>
        </div>
        {showDialogLink && deal.conversationId && (
          <Link href={`/conversations?id=${deal.conversationId}`} className="btn btn-ghost btn-sm">Открыть диалог</Link>
        )}
      </div>

      {error && <div className="notice notice-bad">{error}</div>}

      {deal.archiveReason && (
        <div className="notice spread" style={{ alignItems: 'center', gap: 8 }}>
          <span className="small">Не продажа: {deal.archiveReason === 'spam' ? 'спам' : 'просто вопрос'} — на доске не показывается.</span>
          <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => restoreDealAction(deal.id))}>Вернуть в работу</button>
        </div>
      )}

      {/* Главные действия — то, ради чего менеджер открыл карточку. */}
      {!deal.archiveReason && mode.kind === 'idle' && current?.kind !== 'WON' && current?.kind !== 'LOST' && (
        <div className="deal-actions">
          {/* Заказ уже оформлен (или этапа «Заказ» нет) — следующий шаг: «Купил». */}
          {(current?.kind === 'ORDER' || !orderStage) && wonStage ? (
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => pick(wonStage)}>
              {wonStage.name}
            </button>
          ) : orderStage ? (
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => setMode({ kind: 'order', stageId: orderStage.id })}>
              {orderStage.name}
            </button>
          ) : null}
          {lostStages.map((ls) => (
            <button key={ls.id} className="btn btn-quiet btn-sm" disabled={pending} onClick={() => setMode({ kind: 'lost', stageId: ls.id })}>
              {ls.name}
            </button>
          ))}
        </div>
      )}

      {mode.kind === 'order' && (
        <OrderForm
          initial={deal}
          pending={pending}
          onCancel={() => setMode({ kind: 'idle' })}
          onSubmit={(v) => run(() => moveDealAction(deal.id, mode.stageId, v))}
        />
      )}
      {mode.kind === 'won' && (
        <OrderForm
          initial={deal}
          pending={pending}
          optional
          submitLabel={`Перенести в «${stages.find((x) => x.id === mode.stageId)?.name ?? 'Купил'}»`}
          onCancel={() => setMode({ kind: 'idle' })}
          onSubmit={(v) => run(() => moveDealAction(deal.id, mode.stageId, v))}
        />
      )}
      {mode.kind === 'lost' && (
        <LostForm
          reasons={lostReasons}
          pending={pending}
          onCancel={() => setMode({ kind: 'idle' })}
          onSubmit={(reason) => run(() => moveDealAction(deal.id, mode.stageId, { lostReason: reason }))}
        />
      )}

      {/* Заказ — сумма и товар, если уже оформлен. */}
      {(deal.amount || deal.product) && mode.kind !== 'order' && mode.kind !== 'won' && (
        mode.kind === 'edit' ? (
          <OrderForm
            initial={deal}
            pending={pending}
            submitLabel="Сохранить"
            onCancel={() => setMode({ kind: 'idle' })}
            onSubmit={(v) => run(() => updateDealAction(deal.id, v))}
          />
        ) : (
          <div className="deal-order">
            <div className="spread">
              <span className="deal-amount">{money(deal.amount)}</span>
              <button className="btn btn-quiet btn-sm" onClick={() => setMode({ kind: 'edit' })}>Изменить</button>
            </div>
            {deal.product && <div className="small">{deal.product}</div>}
            {deal.comment && <div className="tiny muted" style={{ marginTop: 3 }}>{deal.comment}</div>}
          </div>
        )
      )}
      {current?.kind === 'LOST' && deal.lostReason && (
        <div className="deal-lost">Отказ: {deal.lostReason}</div>
      )}

      <ReminderBox deal={deal} pending={pending} run={run} closed={current?.kind === 'WON' || current?.kind === 'LOST'} />

      {(deal.purchases.length > 0 || deal.source !== 'WhatsApp напрямую') && (
        <div className="deal-sec">
          {deal.source !== 'WhatsApp напрямую' && (
            <div className="small" style={{ marginBottom: deal.purchases.length ? 10 : 0 }}>
              <span className="muted">Пришёл с рекламы: </span>
              {deal.adUrl ? <a href={deal.adUrl} target="_blank" rel="noreferrer">{deal.source}</a> : <b>{deal.source}</b>}
            </div>
          )}
          {deal.purchases.length > 0 && (
            <>
              <div className="deal-sec-t">
                Повторный клиент · покупал {deal.purchases.length} {deal.purchases.length === 1 ? 'раз' : deal.purchases.length < 5 ? 'раза' : 'раз'}
                {deal.purchases.some((p) => p.amount) ? ` на ${money(deal.purchases.reduce((sum, p) => sum + (p.amount ?? 0), 0))}` : ''}
              </div>
              <ul className="purchases">
                {deal.purchases.map((p) => (
                  <li key={p.id}>
                    <span className="tiny muted" suppressHydrationWarning>{clockWithDay(p.at)}</span>
                    <span className="small">{p.product ?? 'без товара'}</span>
                    <b className="small">{p.amount ? money(p.amount) : ''}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="deal-sec">
        <div className="deal-sec-t">Менеджер</div>
        {members ? (
          <select
            className="select"
            value={deal.assigneeId ?? ''}
            disabled={pending}
            onChange={(e) => e.target.value && run(() => assignDealAction(deal.id, e.target.value))}
          >
            <option value="" disabled>Не передан — выберите менеджера</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        ) : (
          <div className="small">{deal.assigneeName ?? 'Не назначен'}</div>
        )}
      </div>

      <div className="deal-sec">
        <div className="deal-sec-t">
          Этап <span className="muted" style={{ fontWeight: 500 }} suppressHydrationWarning>· {since(deal.stageChangedAt)}</span>
        </div>
        <ol className="stage-rail">
          {stages.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={`stage-step k-${s.kind.toLowerCase()} ${s.id === deal.stageId ? 'on' : ''} ${i < currentIndex && s.kind !== 'LOST' ? 'past' : ''}`}
                disabled={pending}
                onClick={() => pick(s)}
                aria-current={s.id === deal.stageId ? 'step' : undefined}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="deal-sec">
        <div className="deal-sec-t">История</div>
        <form
          className="row"
          style={{ marginBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) run(() => addDealNoteAction(deal.id, note), () => setNote(''));
          }}
        >
          <input className="input" style={{ height: 34 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка: перезвонить, хочет чёрные…" />
          <button className="btn btn-ghost btn-sm" type="submit" disabled={pending || !note.trim()}>Добавить</button>
        </form>
        <div className="rail">
          {deal.events.map((e) => (
            <div key={e.id} className={`rail-item ${e.type === 'order' ? 'on' : ''}`}>
              <div className="small">{e.text}</div>
              <div className="tiny muted" suppressHydrationWarning>{clockWithDay(e.createdAt)}{e.actor ? `, ${e.actor}` : ''}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Значение для <input type="datetime-local"> во времени браузера. */
const localValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Напоминание о клиенте: когда вернуться и зачем. */
function ReminderBox({
  deal,
  pending,
  run,
  closed,
}: {
  deal: DealView;
  pending: boolean;
  run: (fn: () => Promise<DealResult>, after?: () => void) => void;
  closed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState('');
  const [text, setText] = useState(deal.remindNote ?? '');

  const preset = (fn: (d: Date) => void) => {
    const d = new Date();
    d.setSeconds(0, 0);
    fn(d);
    setAt(localValue(d));
  };

  if (closed && !deal.remindAt) return null;
  const due = deal.remindAt && new Date(deal.remindAt) <= new Date();

  return (
    <div className="deal-sec">
      <div className="deal-sec-t">Напоминание</div>
      {deal.remindAt && !open ? (
        <div className={`remind ${due ? 'due' : ''}`}>
          <div>
            <b suppressHydrationWarning>⏰ {clockWithDay(deal.remindAt)}</b>
            {due && <span className="tiny"> — пора</span>}
            {deal.remindNote && <div className="small">{deal.remindNote}</div>}
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-quiet btn-sm" disabled={pending} onClick={() => { setAt(localValue(new Date(deal.remindAt!))); setOpen(true); }}>Изменить</button>
            <button className="btn btn-quiet btn-sm" disabled={pending} onClick={() => run(() => setReminderAction(deal.id, null, ''))}>{due ? 'Сделано' : 'Снять'}</button>
          </div>
        </div>
      ) : !open ? (
        <button className="btn btn-ghost btn-sm" onClick={() => { preset((d) => d.setDate(d.getDate() + 1)); setOpen(true); }}>Напомнить о клиенте</button>
      ) : (
        <form
          className="stage-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!at) return;
            run(() => setReminderAction(deal.id, new Date(at).toISOString(), text), () => setOpen(false));
          }}
        >
          <div className="reason-chips">
            <button type="button" className="chip chip-btn" onClick={() => preset((d) => d.setHours(d.getHours() + 1))}>Через час</button>
            <button type="button" className="chip chip-btn" onClick={() => preset((d) => { d.setDate(d.getDate() + 1); d.setHours(10, 0); })}>Завтра в 10:00</button>
            <button type="button" className="chip chip-btn" onClick={() => preset((d) => { d.setDate(d.getDate() + 3); d.setHours(10, 0); })}>Через 3 дня</button>
            <button type="button" className="chip chip-btn" onClick={() => preset((d) => { d.setDate(d.getDate() + 7); d.setHours(10, 0); })}>Через неделю</button>
          </div>
          <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required style={{ marginBottom: 8 }} />
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="О чём: перезвонить, придёт за размером 41…" maxLength={300} style={{ marginBottom: 10 }} />
          <div className="row">
            <button className="btn btn-primary btn-sm" type="submit" disabled={pending || !at}>Сохранить</button>
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => setOpen(false)}>Отмена</button>
          </div>
        </form>
      )}
    </div>
  );
}
