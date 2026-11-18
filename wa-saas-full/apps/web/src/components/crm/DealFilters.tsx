'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberView } from '@/lib/crm';

/**
 * Поиск клиента, фильтр по менеджеру (менеджеру не нужен — он видит только
 * своих) и быстрые списки: зависшие клиенты и напоминания.
 */
export function DealFilters({
  members,
  manager,
  query,
  filter = '',
  staleCount = 0,
  remindCount = 0,
  staleHours = 24,
  period = null,
}: {
  members: MemberView[] | null;
  manager: string;
  query: string;
  filter?: string;
  staleCount?: number;
  remindCount?: number;
  staleHours?: number;
  /** Отбор по дню, когда пришёл клиент. null — за всё время. */
  period?: { id: string; from: string; to: string; label: string; count: number } | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(query);
  const [from, setFrom] = useState(period?.id === 'custom' ? period.from : '');
  const [to, setTo] = useState(period?.id === 'custom' ? period.to : '');
  const day = period?.id ?? '';

  type Day = { d?: string; from?: string; to?: string };
  const current: Day = !period ? {} : period.id === 'custom' ? { from: period.from, to: period.to } : { d: period.id };
  const go = (next: { m?: string; q?: string; f?: string; day?: Day }) => {
    const sp = new URLSearchParams();
    const m = next.m ?? manager;
    const qq = next.q ?? query;
    const f = next.f ?? filter;
    const dd = next.day ?? current;
    if (m) sp.set('m', m);
    if (qq) sp.set('q', qq);
    if (f) sp.set('f', f);
    if (dd.d) sp.set('d', dd.d);
    if (dd.from) { sp.set('from', dd.from); sp.set('to', dd.to || dd.from); }
    router.replace(`/deals${sp.size ? `?${sp}` : ''}`);
  };

  useEffect(() => {
    if (q.trim() === query) return;
    const t = setTimeout(() => go({ q: q.trim() }), 350);
    return () => clearTimeout(t);
    // go зависит от текущих параметров — они в зависимостях через query/manager.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, manager]);

  return (
    <div className="deal-filters">
      <input className="input" type="search" placeholder="Найти клиента по имени или номеру" value={q} onChange={(e) => setQ(e.target.value)} />
      {members && (
        <select className="select" value={manager} onChange={(e) => go({ m: e.target.value })} aria-label="Менеджер">
          <option value="">Все менеджеры</option>
          <option value="none">Без менеджера</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}
      <div className="seg deal-quick" role="group" aria-label="Быстрый список">
        <button type="button" className={filter === '' ? 'on' : ''} onClick={() => go({ f: '' })}>Все</button>
        <button
          type="button"
          className={`${filter === 'stale' ? 'on' : ''} ${staleCount ? 'has-bad' : ''}`}
          title={`Без движения больше ${staleHours} ч: ни этап, ни переписка`}
          onClick={() => go({ f: 'stale' })}
        >
          Зависшие{staleCount ? <span className="seg-n">{staleCount}</span> : null}
        </button>
        <button type="button" className={`${filter === 'remind' ? 'on' : ''}`} onClick={() => go({ f: 'remind' })}>
          Напоминания{remindCount ? <span className="seg-n">{remindCount}</span> : null}
        </button>
      </div>
      <div className="seg deal-quick" role="group" aria-label="Когда пришёл клиент" title="По дню, когда клиент впервые написал">
        <button type="button" className={day === '' ? 'on' : ''} onClick={() => go({ day: {} })}>Всё время</button>
        <button type="button" className={day === 'today' ? 'on' : ''} onClick={() => go({ day: { d: 'today' } })}>Сегодня</button>
        <button type="button" className={day === 'yesterday' ? 'on' : ''} onClick={() => go({ day: { d: 'yesterday' } })}>Вчера</button>
        <button type="button" className={day === '7' ? 'on' : ''} onClick={() => go({ day: { d: '7' } })}>7 дней</button>
      </div>
      <form
        className={`deal-dates ${day === 'custom' ? 'on' : ''}`}
        onSubmit={(e) => { e.preventDefault(); if (from || to) go({ day: { from: from || to, to: to || from } }); }}
      >
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="С даты" />
        <span className="muted">—</span>
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="По дату" />
        <button type="submit" className="btn btn-sm" disabled={!from && !to}>Показать</button>
      </form>
      {period && (
        <span className="small muted deal-period-note">
          Пришли {period.label}: <b>{period.count}</b> {plural(period.count)}
        </span>
      )}
    </div>
  );
}

function plural(n: number) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return 'клиент';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'клиента';
  return 'клиентов';
}
