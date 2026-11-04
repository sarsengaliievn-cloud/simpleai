'use client';

import { useMemo, useState, useTransition } from 'react';
import { saveStagesAction, saveLostReasonsAction, type DealResult } from '@/app/deals/actions';
import type { StageView } from '@/lib/crm';

type Kind = StageView['kind'];
type Row = { key: string; id: string | null; name: string; kind: Kind };

const KIND_LABEL: Record<Exclude<Kind, 'NEW'>, string> = {
  WORK: 'В работе',
  ORDER: 'Заказ (сумма и товар)',
  WON: 'Купил ✓',
  LOST: 'Отказ ✕',
};

const MAX = 12;
let seq = 0;

/**
 * Этапы воронки: название, тип, порядок. Тип решает, что этап значит для
 * аналитики: «Купил» — продажа, «Отказ» — потерянный клиент. Изменения
 * копятся и сохраняются одной кнопкой — так можно спокойно переставить всё.
 */
export function StageEditor({
  stages,
  counts,
  lostReasons,
  customReasons,
}: {
  stages: StageView[];
  /** Сколько сделок сейчас на каждом этапе. */
  counts: Record<string, number>;
  lostReasons: string[];
  /** Причины свои (а не стандартные). */
  customReasons: boolean;
}) {
  const initial = useMemo<Row[]>(() => stages.map((s) => ({ key: s.id, id: s.id, name: s.name, kind: s.kind })), [stages]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty = JSON.stringify(rows.map(({ id, name, kind }) => [id, name.trim(), kind])) !== JSON.stringify(initial.map(({ id, name, kind }) => [id, name, kind]));

  const run = (fn: () => Promise<DealResult>, ok: string) => {
    setError(null);
    setSaved(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else setSaved(ok);
    });
  };

  const patch = (key: string, next: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const swap = (i: number, j: number) =>
    setRows((list) => {
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  // Что станет со сделками удалённых этапов — то же правило, что на сервере.
  const kept = new Set(rows.map((r) => r.id).filter(Boolean));
  const moves = stages
    .map((s, i) => {
      if (kept.has(s.id) || !counts[s.id]) return null;
      const target = stages.slice(0, i).reverse().find((x) => kept.has(x.id)) ?? stages.find((x) => kept.has(x.id));
      const targetName = rows.find((r) => r.id === target?.id)?.name ?? target?.name ?? '';
      return `${counts[s.id]} сд. из «${s.name}» перейдут в «${targetName}»`;
    })
    .filter(Boolean);
  const kindChanges = rows
    .filter((r) => r.id && counts[r.id] && stages.find((s) => s.id === r.id)?.kind !== r.kind)
    .map((r) => `${counts[r.id!]} сд. в «${r.name}» будут считаться: ${r.kind === 'NEW' ? 'новые' : KIND_LABEL[r.kind].replace(/ \(.*$| [✓✕]$/, '').toLowerCase()}`);

  return (
    <section className="card card-p stage-editor">
      <h2 className="card-t">Этапы воронки</h2>
      <p className="small muted" style={{ marginBottom: 14, maxWidth: '70ch' }}>
        Тип этапа решает, что он значит: <b>Купил</b> — продажа (идёт в выручку), <b>Отказ</b> — клиент потерян, <b>Заказ</b> — спросит сумму и товар.
        Конечных этапов «Купил» и «Отказ» может быть несколько. Первый этап — куда попадают новые клиенты.
      </p>
      {error && <div className="notice notice-bad">{error}</div>}
      {saved && !dirty && <div className="notice notice-ok">{saved}</div>}

      <ol className="stage-edit-list">
        {rows.map((r, i) => {
          const isNew = r.kind === 'NEW' && i === 0;
          return (
            <li key={r.key} className={`k-${r.kind.toLowerCase()}`}>
              <span className="kan-dot" />
              <input
                className="input"
                value={r.name}
                maxLength={40}
                onChange={(e) => patch(r.key, { name: e.target.value })}
                aria-label={`Название этапа ${i + 1}`}
              />
              {isNew ? (
                <span className="tiny muted stage-role">сюда попадает каждый новый клиент</span>
              ) : (
                <select className="select stage-kind" value={r.kind} onChange={(e) => patch(r.key, { kind: e.target.value as Kind })} aria-label={`Тип этапа ${r.name}`}>
                  {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
              )}
              <span className="row stage-tools" style={{ gap: 2 }}>
                {r.id && counts[r.id] ? <span className="tiny muted" title="Сделок на этапе">{counts[r.id]}</span> : null}
                {!isNew && (
                  <>
                    <button type="button" className="btn btn-quiet btn-sm" disabled={pending || i <= 1} onClick={() => swap(i, i - 1)} aria-label="Выше">↑</button>
                    <button type="button" className="btn btn-quiet btn-sm" disabled={pending || i >= rows.length - 1} onClick={() => swap(i, i + 1)} aria-label="Ниже">↓</button>
                    <button type="button" className="btn btn-quiet btn-sm danger" disabled={pending} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>Удалить</button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={pending || rows.length >= MAX}
          onClick={() => {
            seq += 1;
            // Новый этап — перед первым конечным, чтобы не оказаться после «Купил».
            const at = rows.findIndex((r, idx) => idx > 0 && (r.kind === 'ORDER' || r.kind === 'WON' || r.kind === 'LOST'));
            const row: Row = { key: `new-${seq}`, id: null, name: '', kind: 'WORK' };
            setRows((list) => (at < 0 ? [...list, row] : [...list.slice(0, at), row, ...list.slice(at)]));
          }}
        >
          + Добавить этап
        </button>
        <span style={{ flex: 1 }} />
        {dirty && (
          <button type="button" className="btn btn-quiet btn-sm" disabled={pending} onClick={() => { setRows(initial); setError(null); }}>
            Отменить изменения
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending || !dirty}
          onClick={() => run(() => saveStagesAction(rows.map(({ id, name, kind }) => ({ id, name, kind }))), 'Этапы сохранены')}
        >
          {pending ? 'Сохраняю…' : 'Сохранить этапы'}
        </button>
      </div>
      {dirty && (moves.length > 0 || kindChanges.length > 0) && (
        <ul className="tiny muted stage-notes">
          {[...moves, ...kindChanges].map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}

      <LostReasonsEditor key={lostReasons.join("\n") + customReasons} reasons={lostReasons} custom={customReasons} />
    </section>
  );
}

/** Причины отказа на выбор: свои вместо стандартных. */
function LostReasonsEditor({ reasons, custom }: { reasons: string[]; custom: boolean }) {
  const [list, setList] = useState(reasons);
  const [fresh, setFresh] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = list.join('\n') !== reasons.join('\n');

  const save = (next: string[], text: string) =>
    start(async () => {
      const r = await saveLostReasonsAction(next);
      setMsg(r.ok ? { ok: true, text } : { ok: false, text: r.error });
    });

  return (
    <div className="lost-edit">
      <h3 className="card-t" style={{ fontSize: 15 }}>Причины отказа</h3>
      <p className="tiny muted" style={{ marginBottom: 10 }}>
        Их предлагает окно «Отказ». В аналитике видно, какая причина встречается чаще.{custom ? '' : ' Сейчас стоят стандартные.'}
      </p>
      {msg && <div className={`notice ${msg.ok ? 'notice-ok' : 'notice-bad'}`}>{msg.text}</div>}
      <div className="reason-chips">
        {list.map((r) => (
          <span key={r} className="chip reason-edit">
            {r}
            <button type="button" aria-label={`Убрать «${r}»`} onClick={() => setList(list.filter((x) => x !== r))}>×</button>
          </span>
        ))}
      </div>
      <form
        className="row"
        style={{ maxWidth: 520, marginTop: 8, gap: 8, flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          const r = fresh.trim().slice(0, 40);
          if (r && !list.some((x) => x.toLowerCase() === r.toLowerCase()) && list.length < 12) setList([...list, r]);
          setFresh('');
        }}
      >
        <input className="input" style={{ flex: 1, minWidth: 180 }} value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder="Новая причина, например «Не устроила доставка»" maxLength={40} />
        <button className="btn btn-ghost btn-sm" type="submit" disabled={!fresh.trim() || list.length >= 12}>Добавить</button>
        <button className="btn btn-primary btn-sm" type="button" disabled={pending || !dirty || list.length === 0} onClick={() => save(list, 'Причины сохранены')}>
          Сохранить причины
        </button>
        {custom && (
          <button className="btn btn-quiet btn-sm" type="button" disabled={pending} onClick={() => save([], 'Вернули стандартные причины')}>
            Стандартные
          </button>
        )}
      </form>
    </div>
  );
}
