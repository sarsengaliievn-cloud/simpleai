import Link from 'next/link';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { initials, avatarColor, timeAgo, money, agoText } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const ctx = await requireCompany();
  const { db, seesOnlyOwn, user } = ctx;

  const customers = await db.customer.findMany({
    // Менеджер видит клиентов, чьи сделки или диалоги переданы ему.
    where: seesOnlyOwn
      ? { OR: [{ deals: { some: { assigneeId: user.id } } }, { conversations: { some: { assigneeId: user.id } } }] }
      : {},
    orderBy: { lastContactAt: 'desc' },
    take: 200,
    include: {
      conversations: { orderBy: { lastMessageAt: 'desc' }, take: 1, select: { id: true } },
      deals: { orderBy: { createdAt: 'desc' }, include: { stage: true, assignee: true } },
    },
  });

  return (
    <Shell ctx={ctx} title="Клиенты" hint="Все, кто писал в WhatsApp. Карточка создаётся сама при первом сообщении">
      <div className="page">
        <div className="card" style={{ overflowX: 'auto' }}>
          {customers.length === 0 ? (
            <div className="empty">
              <h3>{seesOnlyOwn ? 'Вам пока не передали клиентов' : 'Клиентов пока нет'}</h3>
              <p>{seesOnlyOwn ? 'Они появятся здесь, когда владелец передаст их вам.' : 'Первый появится здесь после первого входящего сообщения.'}</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Клиент</th><th>Телефон</th><th>Этап</th><th>Менеджер</th>
                  <th className="num">Заказов</th><th className="num">Сумма</th><th>Последний контакт</th><th />
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const current = c.deals[0];
                  const orders = c.deals.filter((d) => d.orderedAt);
                  const total = orders.reduce((s, d) => s + (d.amount ?? 0), 0);
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="row">
                          <div className="avatar" style={{ background: avatarColor(c.id) }}>
                            {initials(c.name, c.waId.slice(-2))}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{c.name ?? 'Без имени'}</div>
                            {c.city && <div className="tiny muted">{c.city}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="muted nowrap">{c.phone}</td>
                      <td>{current ? <span className={`stage-chip k-${current.stage.kind.toLowerCase()}`}>{current.stage.name}</span> : '—'}</td>
                      <td className="small">{current?.assignee ? `${current.assignee.firstName} ${current.assignee.lastName}`.trim() : <span className="muted">—</span>}</td>
                      <td className="num">{orders.length || '—'}</td>
                      <td className="num nowrap">{total ? money(total) : '—'}</td>
                      <td className="muted small nowrap">{agoText(c.lastContactAt)}</td>
                      <td className="nowrap" style={{ textAlign: 'right' }}>
                        {current && (
                          <Link href={`/deals?id=${current.id}`} className="btn btn-quiet btn-sm">Сделка</Link>
                        )}
                        {c.conversations[0] && (
                          <Link href={`/conversations?id=${c.conversations[0].id}`} className="btn btn-quiet btn-sm">Диалог</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Shell>
  );
}
