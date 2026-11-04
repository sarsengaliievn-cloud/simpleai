import type { ReactNode } from 'react';
import type { Role } from '@wa/db';
import { Sidebar } from './Sidebar';
import { isSuperAdmin } from '@/lib/admin';
import { sidebarExtras, type ShellCtx } from '@/lib/sidebar';

/**
 * Каркас страницы панели: меню слева, заголовок с одной строкой пояснения
 * и действиями справа. Пояснение отвечает на вопрос «что здесь делать».
 */
export async function Shell({
  ctx,
  title,
  hint,
  actions,
  children,
}: {
  ctx: ShellCtx;
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const extras = await sidebarExtras(ctx);
  return (
    <div className="shell">
      <Sidebar
        companyName={ctx.company.name}
        userName={`${ctx.user.firstName} ${ctx.user.lastName}`.trim()}
        role={ctx.role}
        balance={{ tiyn: ctx.company.balanceTiyn, lastTopup: ctx.company.lastTopupTiyn, exempt: ctx.company.billingExempt }}
        superAdmin={isSuperAdmin(ctx.user.email)}
        aiError={ctx.company.aiError ?? null}
        {...extras}
      />
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
