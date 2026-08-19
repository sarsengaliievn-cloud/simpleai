'use client';

import Link from 'next/link';
import { useEffect } from 'react';
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

export function ConversationList({
  items,
  activeId,
  filter,
}: {
  items: Item[];
  activeId: string | null;
  filter: string;
}) {
  const router = useRouter();

  // Пока нет вебсокетов — тихое обновление раз в 8 секунд.
  // Спринт 3 заменит это на SSE.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [router]);

  return (
    <div className="inbox-list">
      <div className="inbox-filters">
        <input className="input" placeholder="Поиск по имени или номеру" style={{ height: 38 }} />
        <div className="filter-row">
          {FILTERS.map(([key, label]) => (
            <Link
              key={key}
              href={`/conversations?filter=${key}`}
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
            <p>Под этот фильтр диалогов нет.</p>
          </div>
        )}

        {items.map((c) => (
          <Link
            key={c.id}
            href={`/conversations?filter=${filter}&id=${c.id}`}
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
