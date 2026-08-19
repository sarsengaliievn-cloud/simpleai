import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';

export const dynamic = 'force-dynamic';

const DAYS = 14;

export default async function AnalyticsPage() {
  const { company, db } = await requireCompany();

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  // Объём небольшой, поэтому считаем в приложении: одна выборка вместо
  // пяти агрегирующих запросов, и всё под tenant-фильтром.
  const messages = await db.message.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, direction: true, authorType: true, conversationId: true },
    orderBy: { createdAt: 'asc' },
  });

  const [conversations, customers, aiHandled, handedOver] = await Promise.all([
    db.conversation.count(),
    db.customer.count(),
    db.message.count({ where: { authorType: 'AI' } }),
    db.conversation.count({ where: { mode: 'HUMAN' } }),
  ]);

  const byDay = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const m of messages) {
    const key = m.createdAt.toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, byDay.get(key)! + 1);
  }

  const series = [...byDay.entries()];
  const max = Math.max(1, ...series.map(([, v]) => v));

  const aiCount = messages.filter((m) => m.authorType === 'AI').length;
  const managerCount = messages.filter((m) => m.authorType === 'MANAGER').length;
  const answered = aiCount + managerCount;
  const aiShare = answered ? Math.round((aiCount / answered) * 100) : 0;

  // Среднее время ответа: разрыв между входящим и следующим исходящим.
  const gaps: number[] = [];
  const byConversation = new Map<string, typeof messages>();
  for (const m of messages) {
    const list = byConversation.get(m.conversationId) ?? [];
    list.push(m);
    byConversation.set(m.conversationId, list);
  }
  for (const list of byConversation.values()) {
    for (let i = 0; i < list.length - 1; i += 1) {
      if (list[i]!.direction === 'INBOUND' && list[i + 1]!.direction === 'OUTBOUND') {
        gaps.push(list[i + 1]!.createdAt.getTime() - list[i]!.createdAt.getTime());
      }
    }
  }
  const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000) : null;
  const avgLabel = avgGap === null ? '—' : avgGap < 90 ? `${avgGap} сек` : `${Math.round(avgGap / 60)} мин`;

  const kpis: Array<[string, string, string]> = [
    ['Сообщений за 14 дней', String(messages.length), 'входящие и исходящие'],
    ['Диалогов', String(conversations), 'всего в базе'],
    ['Клиентов', String(customers), 'создано автоматически'],
    ['Ответов ассистента', String(aiHandled), 'за всё время'],
    ['Диалогов у менеджера', String(handedOver), 'сейчас в ручном режиме'],
    ['Среднее время ответа', avgLabel, 'от вопроса до ответа'],
  ];

  return (
    <div className="shell">
      <Sidebar companyName={company.name} />
      <div className="main">
        <header className="top">
          <h1>Аналитика</h1>
          <span className="chip" style={{ marginLeft: 'auto' }}>за 14 дней</span>
        </header>

        <div className="page">
          {messages.length === 0 && (
            <div className="card card-p" style={{ marginBottom: 16 }}>
              <p className="small muted">
                Данных пока нет. Цифры появятся, как только пойдёт реальная переписка —
                считается всё из базы, ничего не подставляется.
              </p>
            </div>
          )}

          <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {kpis.map(([label, value, hint]) => (
              <div className="kpi" key={label}>
                <div className="kpi-l">{label}</div>
                <div className="kpi-v" style={{ fontSize: 23 }}>{value}</div>
                <div className="kpi-d muted">{hint}</div>
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', marginTop: 16 }}>
            <div className="card card-p">
              <div style={{ fontWeight: 700, marginBottom: 16 }}>Сообщения по дням</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
                {series.map(([day, value]) => (
                  <div key={day} style={{ flex: 1, textAlign: 'center' }} title={`${day}: ${value}`}>
                    <div
                      style={{
                        height: `${Math.max(2, (value / max) * 120)}px`,
                        background: 'var(--pine)',
                        opacity: value ? 0.35 + 0.65 * (value / max) : 0.15,
                        borderRadius: 3,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="spread tiny muted" style={{ marginTop: 8 }}>
                <span>{series[0]?.[0]}</span>
                <span>{series.at(-1)?.[0]}</span>
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontWeight: 700, marginBottom: 14 }}>Ассистент против человека</div>
              <div className="row" style={{ gap: 0, height: 26, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
                <div style={{ flex: Math.max(aiShare, 1), background: 'var(--pine)', height: '100%' }} />
                <div style={{ flex: Math.max(100 - aiShare, 1), background: 'var(--amber)', height: '100%' }} />
              </div>
              <div className="spread small" style={{ marginBottom: 7 }}>
                <span className="row"><span className="dot" style={{ color: 'var(--pine)' }} />Ответил ассистент</span>
                <span style={{ fontWeight: 700 }}>{aiShare}% · {aiCount}</span>
              </div>
              <div className="spread small">
                <span className="row"><span className="dot" style={{ color: 'var(--amber)' }} />Ответил менеджер</span>
                <span style={{ fontWeight: 700 }}>{100 - aiShare}% · {managerCount}</span>
              </div>
              <p className="tiny muted" style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                Доля ассистента считается по отправленным ответам. Диалоги, где он промолчал
                и позвал человека, попадают в правую часть — так и должно быть.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
