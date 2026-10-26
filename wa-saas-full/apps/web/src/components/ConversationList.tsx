'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { initials, avatarColor, timeAgo } from '@/lib/format';

type Item = {
  id: string;
  name: string;
  preview: string;
  lastMessageAt: Date;
  unread: number;
  mode: 'AI' | 'HUMAN';
  status: 'OPEN' | 'PENDING' | 'CLOSED';
};

const FILTERS: Array<[string, string]> = [
  ['all', 'Все'],
  ['unread', 'Непрочитанные'],
  ['human', 'У менеджера'],
  ['closed', 'Закрытые'],
];

function href(params: { filter: string; q: string; id?: string }) {
  const sp = new URLSearchParams({ filter: params.filter });
  if (params.q) sp.set('q', params.q);
  if (params.id) sp.set('id', params.id);
  return `/conversations?${sp}`;
}

export function ConversationList({
  items,
  activeId,
  filter,
  query,
}: {
  items: Item[];
  activeId: string | null;
  filter: string;
  query: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(query);

  // Поиск с задержкой: не дёргаем сервер на каждую букву.
  useEffect(() => {
    if (q.trim() === query) return;
    const t = setTimeout(() => router.replace(href({ filter, q: q.trim() })), 350);
    return () => clearTimeout(t);
  }, [q, query, filter, router]);

  // Пока нет вебсокетов — тихое обновление раз в 8 секунд.
  // Спринт 3 заменит это на SSE.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [router]);

  return (
    <div className="inbox-list">
      <div className="inbox-filters">
        <input
          className="input"
          type="search"
          placeholder="Поиск по имени или номеру"
          style={{ height: 38 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="filter-row">
          {FILTERS.map(([key, label]) => (
            <Link
              key={key}
              href={href({ filter: key, q: query })}
              className={`chip ${filter === key ? 'chip-ok' : ''}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {items.length === 0 && (
          <div className="empty">
            <h3>Здесь пусто</h3>
            <p>{query ? `По запросу «${query}» никого не нашлось.` : 'Под этот фильтр диалогов нет.'}</p>
          </div>
        )}

        {items.map((c) => (
          <Link
            key={c.id}
            href={href({ filter, q: query, id: c.id })}
            className={`conv ${c.id === activeId ? 'on' : ''}`}
          >
            <div className="avatar" style={{ background: avatarColor(c.id) }}>
              {initials(c.name, '??')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="spread">
                <span className="conv-n">{c.name}</span>
                <span className="tiny muted">{timeAgo(c.lastMessageAt)}</span>
              </div>
              <div className="conv-p">{c.preview}</div>
              <div className="row" style={{ marginTop: 5, gap: 6 }}>
                {c.status === 'CLOSED' ? (
                  <span className="chip">Закрыт</span>
                ) : c.mode === 'AI' ? (
                  <span className="chip chip-ok">
                    <span className="dot" />
                    AI
                  </span>
                ) : (
                  <span className="chip chip-warn">
                    <span className="dot" />
                    Менеджер
                  </span>
                )}
                {c.unread > 0 && <span className="nav-badge">{c.unread}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
