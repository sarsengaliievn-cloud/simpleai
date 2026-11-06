import { prisma } from '@wa/db';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { AddMemberForm, ResetPasswordForm } from '@/components/TeamForms';
import { initials, avatarColor, agoText } from '@/lib/format';
import { removeMember } from './actions';
import { onShiftNow, SHIFT_MAX_MS } from '@wa/core';
import { AutoAssignToggle } from '@/components/crm/AutoAssignToggle';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Владелец', ADMIN: 'Администратор', MANAGER: 'Менеджер', OPERATOR: 'Оператор', ANALYST: 'Аналитик',
};
const ROLE_HINT: Record<string, string> = {
  OWNER: 'Всё, включая команду и настройки',
  ADMIN: 'Всё, кроме оплаты',
  MANAGER: 'Только переданные ему клиенты и своя аналитика',
};

export default async function TeamPage() {
  const ctx = await requireCompany('team:manage');
  const { db, user } = ctx;

  const members = await db.membership.findMany({ include: { user: true }, orderBy: { createdAt: 'asc' } });
  // Открытые сделки у каждого — чтобы перед удалением было видно, кого передать.
  const open = await db.deal.groupBy({
    by: ['assigneeId'],
    where: { assigneeId: { not: null }, archivedAt: null, stage: { kind: { notIn: ['WON', 'LOST'] } } },
    _count: { _all: true },
  });
  const openBy = new Map(open.map((o) => [o.assigneeId, o._count._all]));
  const lastSeen = await prisma.session.groupBy({
    by: ['userId'],
    where: { userId: { in: members.map((m) => m.userId) } },
    _max: { createdAt: true },
  });
  const seenBy = new Map(lastSeen.map((s) => [s.userId, s._max.createdAt]));
  const now = new Date();
  const shiftText = (m: (typeof members)[number]) => {
    if (!m.onShift || !m.shiftStartedAt || now.getTime() - m.shiftStartedAt.getTime() > SHIFT_MAX_MS) return null;
    const from = m.shiftStartedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: ctx.company.timezone || 'Asia/Almaty' });
    return onShiftNow(m, now) ? { on: true, text: `на смене с ${from}` } : { on: false, text: `смена с ${from}, панель закрыта` };
  };
  const onShiftCount = members.filter((m) => onShiftNow(m, now)).length;

  return (
    <Shell ctx={ctx} title="Команда" hint="Менеджеры со своим входом. Менеджер видит только клиентов, которых вы ему передали.">
      <div className="page" style={{ maxWidth: 1100 }}>
        <section className="card card-p" style={{ marginBottom: 18 }}>
          <h2 className="card-t">Распределение клиентов</h2>
          <AutoAssignToggle on={ctx.company.autoAssign} />
          <p className="tiny muted" style={{ marginTop: 10, maxWidth: '72ch' }}>
            Менеджер нажимает «Начать смену» внизу меню — и попадает в очередь. Клиенты идут по кругу: кто дольше всех без нового клиента, тот получает следующего.
            Закрыл панель больше чем на 15 минут — очередь его пропускает. Смена заканчивается кнопкой или сама через 14 часов.
            {ctx.company.autoAssign && (onShiftCount ? ` Сейчас на смене: ${onShiftCount}.` : ' Сейчас на смене никого — новые клиенты ждут без менеджера.')}
          </p>
        </section>

        <section className="card" style={{ overflowX: 'auto', marginBottom: 18 }}>
          <table>
            <thead>
              <tr><th>Сотрудник</th><th>Роль</th><th>Клиентов в работе</th><th>Смена</th><th>Последний вход</th><th /></tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const name = `${m.user.firstName} ${m.user.lastName}`.trim();
                const self = m.userId === user.id;
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="row">
                        <div className="avatar" style={{ background: avatarColor(m.userId) }}>{initials(name, '?')}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{name}{self ? ' (вы)' : ''}</div>
                          <div className="tiny muted">{m.user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ minWidth: 220 }}>
                      <div className="small" style={{ fontWeight: 600 }}>{ROLE_LABEL[m.role]}</div>
                      <div className="tiny muted">{ROLE_HINT[m.role] ?? ''}</div>
                    </td>
                    <td className="num">{openBy.get(m.userId) ?? 0}</td>
                    <td className="small nowrap">
                      {(() => {
                        const st = shiftText(m);
                        return st ? <span className={`chip ${st.on ? 'chip-ok' : 'chip-warn'}`}>{st.text}</span> : <span className="muted">—</span>;
                      })()}
                    </td>
                    <td className="small muted nowrap">{seenBy.get(m.userId) ? agoText(seenBy.get(m.userId)!) : 'ещё не входил'}</td>
                    <td className="nowrap" style={{ textAlign: 'right' }}>
                      {m.role !== 'OWNER' && !self && (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <ResetPasswordForm membershipId={m.id} name={m.user.firstName} />
                          <form action={removeMember.bind(null, m.id)}>
                            <button className="btn btn-quiet btn-sm danger" type="submit">Убрать</button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card card-p">
          <h2 className="card-t">Добавить менеджера</h2>
          <p className="small muted" style={{ marginBottom: 16, maxWidth: '60ch' }}>
            Задайте почту и пароль и передайте их сотруднику. Он входит на той же странице входа, что и вы.
          </p>
          <AddMemberForm />
        </section>
      </div>
    </Shell>
  );
}
