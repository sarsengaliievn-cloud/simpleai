'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/login/actions';
import { Icon, type IconName } from './Icon';

type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'ANALYST';

/** Кто какие разделы видит — то же, что проверяет сервер в requireCompany. */
const ADMINS: Role[] = ['OWNER', 'ADMIN'];
const EVERYONE: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'ANALYST'];

const NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: IconName; roles: Role[] }> }> = [
  {
    group: 'Работа',
    items: [
      { href: '/conversations', label: 'Диалоги', icon: 'chat', roles: EVERYONE },
      { href: '/deals', label: 'Сделки', icon: 'board', roles: EVERYONE },
      { href: '/customers', label: 'Клиенты', icon: 'people', roles: EVERYONE },
      { href: '/analytics', label: 'Аналитика', icon: 'chart', roles: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'] },
    ],
  },
  {
    group: 'Ассистент',
    items: [
      { href: '/assistant', label: 'Как отвечает', icon: 'spark', roles: ADMINS },
      { href: '/knowledge', label: 'База знаний', icon: 'book', roles: ADMINS },
      { href: '/playground', label: 'Тестовый чат', icon: 'flask', roles: ADMINS },
    ],
  },
  {
    group: 'Компания',
    items: [
      { href: '/whatsapp', label: 'WhatsApp', icon: 'phone', roles: ADMINS },
      { href: '/team', label: 'Команда', icon: 'team', roles: ADMINS },
      { href: '/settings', label: 'Настройки', icon: 'gear', roles: ADMINS },
    ],
  },
];

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Владелец', ADMIN: 'Администратор', MANAGER: 'Менеджер', OPERATOR: 'Оператор', ANALYST: 'Аналитик',
};

export function Sidebar({
  companyName,
  userName,
  role = 'OWNER',
}: {
  companyName: string;
  userName?: string;
  role?: Role;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  // На телефоне меню закрывается при переходе на другую страницу.
  useEffect(() => setOpen(false), [path]);

  return (
    <>
      <button className="burger burger-fixed" aria-label="Открыть меню" onClick={() => setOpen(true)}>
        <Icon name="menu" />
      </button>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="side-top">
          <Link href="/conversations" className="brand">
            <span className="brand-mark" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3.5h10a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H8.2L5 13.5v-2.5H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" fill="#fff" />
                <path d="m5.6 7.3 1.5 1.5 3.3-3.1" stroke="var(--pine)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            SaudaBot
          </Link>
          <div className="side-company" title={companyName}>{companyName}</div>
        </div>

        <nav className="side-nav">
          {NAV.map(({ group, items }) => {
            const visible = items.filter((i) => i.roles.includes(role));
            if (visible.length === 0) return null;
            return (
              <div key={group} className="nav-section">
                <div className="nav-group">{group}</div>
                {visible.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-i ${path.startsWith(item.href) ? 'on' : ''}`}
                    aria-current={path.startsWith(item.href) ? 'page' : undefined}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="side-user">
          <div style={{ minWidth: 0 }}>
            <div className="side-user-n">{userName ?? ''}</div>
            <div className="tiny muted">{ROLE_LABEL[role]}</div>
          </div>
          <form action={logout}>
            <button className="btn btn-quiet btn-sm" type="submit">Выйти</button>
          </form>
        </div>
      </aside>
    </>
  );
}
