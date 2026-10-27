'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberView } from '@/lib/crm';

/** Поиск клиента и фильтр по менеджеру. Менеджеру фильтр не нужен — он видит только своих. */
export function DealFilters({ members, manager, query }: { members: MemberView[] | null; manager: string; query: string }) {
  const router = useRouter();
  const [q, setQ] = useState(query);

  const go = (next: { m?: string; q?: string }) => {
    const sp = new URLSearchParams();
    const m = next.m ?? manager;
    const qq = next.q ?? query;
    if (m) sp.set('m', m);
    if (qq) sp.set('q', qq);
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
    </div>
  );
}
