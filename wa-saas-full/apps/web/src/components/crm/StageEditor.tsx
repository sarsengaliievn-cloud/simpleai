'use client';

import { useState, useTransition } from 'react';
import {
  renameStageAction,
  addStageAction,
  deleteStageAction,
  shiftStageAction,
  type DealResult,
} from '@/app/deals/actions';
import type { StageView } from '@/lib/crm';

const ROLE: Record<StageView['kind'], string> = {
  NEW: 'сюда попадает каждый новый клиент',
  WORK: 'в работе',
  ORDER: 'здесь спрашиваем сумму и товар',
  WON: 'заказ выдан или оплачен',
  LOST: 'здесь спрашиваем причину отказа',
};

/** Этапы воронки: переименовать любой, свои «в работе» — добавить, сдвинуть, удалить. */
export function StageEditor({ stages }: { stages: StageView[] }) {
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(stages.map((s) => [s.id, s.name])));
  const [fresh, setFresh] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<DealResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else after?.();
    });
  };

  return (
    <section className="card card-p stage-editor">
      <h2 className="card-t">Этапы воронки</h2>
      <p className="small muted" style={{ marginBottom: 14, maxWidth: '64ch' }}>
        Названия можно менять. Свои этапы встают между «Новый» и заказом — например, «Ждёт оплату» или «Примерка».
      </p>
      {error && <div className="notice notice-bad">{error}</div>}
      <ol className="stage-edit-list">
        {stages.map((s, i) => (
          <li key={s.id} className={`k-${s.kind.toLowerCase()}`}>
            <span className="kan-dot" />
            <input
              className="input"
              value={names[s.id] ?? ''}
              onChange={(e) => setNames({ ...names, [s.id]: e.target.value })}
              onBlur={() => names[s.id] !== s.name && run(() => renameStageAction(s.id, names[s.id] ?? ''))}
              aria-label={`Название этапа ${i + 1}`}
            />
            <span className="tiny muted stage-role">{ROLE[s.kind]}</span>
            {s.kind === 'WORK' && (
              <span className="row" style={{ gap: 2 }}>
                <button className="btn btn-quiet btn-sm" disabled={pending || stages[i - 1]?.kind !== 'WORK'} onClick={() => run(() => shiftStageAction(s.id, -1))} aria-label="Выше">↑</button>
                <button className="btn btn-quiet btn-sm" disabled={pending || stages[i + 1]?.kind !== 'WORK'} onClick={() => run(() => shiftStageAction(s.id, 1))} aria-label="Ниже">↓</button>
                <button className="btn btn-quiet btn-sm danger" disabled={pending} onClick={() => run(() => deleteStageAction(s.id))}>Удалить</button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <form
        className="row"
        style={{ marginTop: 12, maxWidth: 420 }}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addStageAction(fresh), () => setFresh(''));
        }}
      >
        <input className="input" value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder="Новый этап, например «Ждёт оплату»" />
        <button className="btn btn-ghost" type="submit" disabled={pending || !fresh.trim()}>Добавить</button>
      </form>
    </section>
  );
}
