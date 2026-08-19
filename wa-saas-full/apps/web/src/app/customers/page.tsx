import Link from 'next/link';
import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { initials, avatarColor, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const { company, db } = await requireCompany();

  const customers = await db.customer.findMany({
    orderBy: { lastContactAt: 'desc' },
    take: 100,
    include: {
      _count: { select: { conversations: true } },
      conversations: { orderBy: { lastMessageAt: 'desc' }, take: 1, select: { id: true, mode: true } },
    },
  });

  return (
    <div className="shell">
      <Sidebar companyName={company.name} />
      <div className="main">
        <header className="top">
          <h1>Клиенты</h1>
          <span className="chip" style={{ marginLeft: 'auto' }}>{customers.length} всего</span>
        </header>

        <div className="page">
          <p className="small muted" style={{ marginBottom: 16 }}>
            Карточка создаётся сама, как только человек впервые пишет на подключённый номер.
            Вручную никого заводить не нужно.
          </p>

          <div className="card" style={{ overflowX: 'auto' }}>
            {customers.length === 0 ? (
              <div className="empty">
                <h3>Клиентов пока нет</h3>
                <p>Первый появится здесь после первого входящего сообщения.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Клиент</th><th>Телефон</th><th>Город</th>
                    <th>Диалогов</th><th>Последний контакт</th><th />
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="row">
                          <div className="avatar" style={{ background: avatarColor(c.id) }}>
                            {initials(c.name, c.waId.slice(-2))}
                          </div>
                          <span style={{ fontWeight: 600 }}>{c.name ?? 'Без имени'}</span>
                        </div>
                      </td>
                      <td className="mono muted">{c.phone}</td>
                      <td className="muted">{c.city ?? '—'}</td>
                      <td className="mono">{c._count.conversations}</td>
                      <td className="muted small">{timeAgo(c.lastContactAt)} назад</td>
                      <td>
                        {c.conversations[0] && (
                          <Link href={`/conversations?id=${c.conversations[0].id}`} className="btn btn-quiet btn-sm">
                            Открыть диалог
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
