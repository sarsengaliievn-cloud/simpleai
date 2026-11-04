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
}: {
  members: MemberView[] | null;
  manager: string;
  query: string;
  filter?: string;
  staleCount?: number;
  remindCount?: number;
  staleHours?: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState(query);

  const go = (next: { m?: string; q?: string; f?: string }) => {
    const sp = new URLSearchParams();
    const m = next.m ?? manager;
    const qq = next.q ?? query;
    const f = next.f ?? filter;
    if (m) sp.set('m', m);
    if (qq) sp.set('q', qq);
    if (f) sp.set('f', f);
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
    </div>
  );
}
