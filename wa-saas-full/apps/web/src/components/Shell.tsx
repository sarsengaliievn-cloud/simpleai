import type { ReactNode } from 'react';
import type { Role } from '@wa/db';
import { Sidebar } from './Sidebar';

/**
 * Каркас страницы панели: меню слева, заголовок с одной строкой пояснения
 * и действиями справа. Пояснение отвечает на вопрос «что здесь делать».
 */
export function Shell({
  ctx,
  title,
  hint,
  actions,
  children,
}: {
  ctx: { company: { name: string }; user: { firstName: string; lastName: string }; role: Role };
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <Sidebar companyName={ctx.company.name} userName={`${ctx.user.firstName} ${ctx.user.lastName}`.trim()} role={ctx.role} />
      <div className="main">
        <header className="top">
          <div className="top-t">
            <h1>{title}</h1>
            {hint && <p className="top-hint">{hint}</p>}
          </div>
          {actions && <div className="top-a">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}
