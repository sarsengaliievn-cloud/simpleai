'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  moveDealAction,
  assignDealAction,
  updateDealAction,
  addDealNoteAction,
  type DealResult,
} from '@/app/deals/actions';
import type { DealView, MemberView, StageView } from '@/lib/crm';
import { money, clockWithDay, since } from '@/lib/format';
import { OrderForm, LostForm } from './StageForms';

type Mode = { kind: 'idle' } | { kind: 'order'; stageId: string } | { kind: 'lost'; stageId: string } | { kind: 'edit' };

/**
 * Карточка сделки: этап, менеджер, заказ, история. Этапы показаны нитью —
 * той же, что в диалоге: видно, где клиент сейчас и что уже пройдено.
 */
export function DealPanel({
  deal,
  stages,
  members,
  showDialogLink = false,
}: {
  deal: DealView;
  stages: StageView[];
  /** null — пользователь не может передавать клиентов (менеджер). */
  members: MemberView[] | null;
  showDialogLink?: boolean;
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();

  const current = stages.find((s) => s.id === deal.stageId);
  const currentIndex = stages.findIndex((s) => s.id === deal.stageId);
  const orderStage = stages.find((s) => s.kind === 'ORDER');
  const lostStage = stages.find((s) => s.kind === 'LOST');
  const wonStage = stages.find((s) => s.kind === 'WON');

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
    if (stage.kind === 'ORDER') return setMode({ kind: 'order', stageId: stage.id });
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

      {/* Главные действия — то, ради чего менеджер открыл карточку. */}
      {mode.kind === 'idle' && current?.kind !== 'WON' && current?.kind !== 'LOST' && (
        <div className="deal-actions">
          {/* Заказ уже оформлен — следующий шаг: выдать. */}
          {current?.kind === 'ORDER' && wonStage ? (
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => moveDealAction(deal.id, wonStage.id))}>
              {wonStage.name}
            </button>
          ) : orderStage ? (
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => setMode({ kind: 'order', stageId: orderStage.id })}>
              {orderStage.name}
            </button>
          ) : null}
          {lostStage && (
            <button className="btn btn-quiet btn-sm" disabled={pending} onClick={() => setMode({ kind: 'lost', stageId: lostStage.id })}>
              Отказ
            </button>
          )}
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
      {mode.kind === 'lost' && (
        <LostForm
          pending={pending}
          onCancel={() => setMode({ kind: 'idle' })}
          onSubmit={(reason) => run(() => moveDealAction(deal.id, mode.stageId, { lostReason: reason }))}
        />
      )}

      {/* Заказ — сумма и товар, если уже оформлен. */}
      {(deal.amount || deal.product) && mode.kind !== 'order' && (
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
