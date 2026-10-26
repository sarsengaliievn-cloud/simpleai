'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/login/actions';

/** [href, подпись, готово ли]. Незаконченное показываем, но не кликаем — */
/** так видно план, и при этом никто не упирается в 404.                  */
const NAV: Array<[string, Array<[string, string, boolean]>]> = [
  ['Работа', [
    ['/conversations', 'Диалоги', true],
    ['/customers', 'Клиенты', true],
    ['/leads', 'Лиды', false],
  ]],
  ['Ассистент', [
    ['/assistant', 'Настройки ассистента', true],
    ['/knowledge', 'База знаний', true],
    ['/playground', 'Тестовый чат', true],
  ]],
  ['Настройка', [
    ['/whatsapp', 'WhatsApp', true],
    ['/analytics', 'Аналитика', true],
    ['/settings', 'Настройки', true],
  ]],
];

export function Sidebar({ companyName, userName }: { companyName: string; userName?: string }) {
  const path = usePathname();

  return (
    <aside className="side">
      <div className="side-top">
        <span className="logo" style={{ fontSize: 15 }}>
          <span className="logo-mark" />
          Zerde
        </span>
        <div className="row" style={{ marginTop: 12, padding: '7px 9px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
          <div className="small" style={{ fontWeight: 700 }}>{companyName}</div>
        </div>
      </div>

      <nav className="side-nav">
        {NAV.map(([group, items]) => (
          <div key={group}>
            <div className="nav-group">{group}</div>
            {items.map(([href, label, ready]) =>
              ready ? (
                <Link key={href} href={href} className={`nav-i ${path.startsWith(href) ? 'on' : ''}`}>
                  <span>{label}</span>
                </Link>
              ) : (
                <span key={href} className="nav-i" style={{ opacity: 0.45, cursor: 'default' }} title="Ещё не сделано">
                  <span>{label}</span>
                  <span className="tiny muted" style={{ marginLeft: 'auto' }}>скоро</span>
                </span>
              ),
            )}
          </div>
        ))}
      </nav>

      <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
        <div className="spread">
          <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {userName ?? ''}
          </div>
          <form action={logout}>
            <button className="btn btn-quiet btn-sm" type="submit">Выйти</button>
          </form>
        </div>
      </div>
    </aside>
  );
}
