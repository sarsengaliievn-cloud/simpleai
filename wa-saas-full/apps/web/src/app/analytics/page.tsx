import Link from 'next/link';
import { funnel } from '@wa/core';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { DayBars } from '@/components/DayBars';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PERIODS: Array<[number, string]> = [[7, '7 дней'], [30, '30 дней'], [90, '90 дней']];
const DAY = 24 * 60 * 60 * 1000;

type Props = { searchParams: Promise<{ d?: string }> };

export default async function AnalyticsPage({ searchParams }: Props) {
  const { d } = await searchParams;
  const days = PERIODS.some(([n]) => String(n) === d) ? Number(d) : 30;
  const ctx = await requireCompany('analytics:read');
  const { db, company, ownDeals, seesOnlyOwn } = ctx;

  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);
  const inPeriod = { gte: from };

  // Все сделки, у которых в периоде было хоть одно событие воронки.
  const deals = await db.deal.findMany({
    where: {
      ...ownDeals,
      OR: [
        { createdAt: inPeriod }, { assignedAt: inPeriod }, { orderedAt: inPeriod },
        { wonAt: inPeriod }, { lostAt: inPeriod },
      ],
    },
    select: {
      createdAt: true, assignedAt: true, orderedAt: true, wonAt: true, lostAt: true,
      amount: true, lostReason: true, assigneeId: true,
      assignee: { select: { firstName: true, lastName: true } },
    },
  });
  const f = funnel(deals, from, to);

  // По дням — в часовом поясе компании, иначе ночные заявки уезжают во вчера.
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: company.timezone || 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' });
  const label = new Intl.DateTimeFormat('ru-RU', { timeZone: company.timezone || 'Asia/Almaty', day: 'numeric', month: 'short' });
  const keys: Array<{ key: string; label: string }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const at = new Date(to.getTime() - i * DAY);
    keys.push({ key: dayKey.format(at), label: label.format(at) });
  }
  const count = (pick: (x: (typeof deals)[number]) => Date | null) => {
    const map = new Map(keys.map((k) => [k.key, 0]));
    for (const x of deals) {
      const at = pick(x);
      if (at && at >= from) {
        const k = dayKey.format(at);
        if (map.has(k)) map.set(k, map.get(k)! + 1);
      }
    }
    return keys.map((k) => ({ label: k.label, value: map.get(k.key) ?? 0 }));
  };
  const chatsByDay = count((x) => x.createdAt);
  const ordersByDay = count((x) => x.orderedAt);

  // Время от первого сообщения до заказа — медиана, среднее врёт из-за долгих хвостов.
  const waits = deals
    .filter((x) => x.orderedAt && x.orderedAt >= from)
    .map((x) => x.orderedAt!.getTime() - x.createdAt.getTime())
    .sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor(waits.length / 2)]! : null;
  const medianLabel = median === null ? '—' : median < 2 * 3600_000 ? `${Math.max(1, Math.round(median / 60000))} мин` : median < 2 * DAY ? `${Math.round(median / 3600_000)} ч` : `${Math.round(median / DAY)} дн`;

  // По менеджерам: сколько получил, сколько довёл до заказа.
  const byManager = new Map<string, { name: string; assigned: number; ordered: number; revenue: number }>();
  for (const x of deals) {
    if (!x.assigneeId) continue;
    const row = byManager.get(x.assigneeId) ?? {
      name: x.assignee ? `${x.assignee.firstName} ${x.assignee.lastName}`.trim() : 'Без имени',
      assigned: 0, ordered: 0, revenue: 0,
    };
    if (x.assignedAt && x.assignedAt >= from) row.assigned += 1;
    if (x.orderedAt && x.orderedAt >= from) {
      row.ordered += 1;
      row.revenue += x.amount ?? 0;
    }
    byManager.set(x.assigneeId, row);
  }
  const managers = [...byManager.values()].sort((a, b) => b.revenue - a.revenue);

  // Ассистент: сколько ответил сам, сколько передал людям.
  const [aiAnswers, humanAnswers] = seesOnlyOwn
    ? [0, 0]
    : await Promise.all([
        db.message.count({ where: { authorType: 'AI', createdAt: inPeriod } }),
        db.message.count({ where: { authorType: 'MANAGER', createdAt: inPeriod } }),
      ]);
  const aiShare = aiAnswers + humanAnswers ? Math.round((aiAnswers / (aiAnswers + humanAnswers)) * 100) : 0;

  const steps: Array<{ label: string; value: number; hint: string }> = [
    { label: 'Обращения', value: f.created, hint: 'клиент написал' },
    { label: 'Переданы менеджеру', value: f.assigned, hint: 'вы передали клиента' },
    { label: 'Заказы', value: f.ordered, hint: 'отмечен «Новый заказ»' },
    { label: 'Выданы', value: f.won, hint: 'заказ выдан или оплачен' },
  ];
  const top = Math.max(1, ...steps.map((s) => s.value));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <Shell
      ctx={ctx}
      title="Аналитика"
      hint={seesOnlyOwn ? 'Ваши клиенты: сколько пришло и сколько купили' : 'Сколько клиентов написало и сколько из них купило'}
      actions={
        <nav className="seg" aria-label="Период">
          {PERIODS.map(([n, text]) => (
            <Link key={n} href={`/analytics?d=${n}`} className={n === days ? 'on' : ''} aria-current={n === days ? 'page' : undefined}>
              {text}
            </Link>
          ))}
        </nav>
      }
    >
      <div className="page">
        <div className="kpis kpis-5">
          <div className="kpi">
            <div className="kpi-l">Обращений</div>
            <div className="kpi-v">{f.created}</div>
            <div className="kpi-d muted">новых сделок за период</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">Заказов</div>
            <div className="kpi-v">{f.ordered}</div>
            <div className="kpi-d muted">{f.won ? `${f.won} уже выдано` : 'отмечено «Новый заказ»'}</div>
          </div>
          <div className="kpi kpi-accent">
            <div className="kpi-l">Конверсия в заказ</div>
            <div className="kpi-v">{f.created ? `${String(f.conversion).replace('.', ',')}%` : '—'}</div>
            <div className="kpi-d muted">заказы ÷ обращения</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">Выручка</div>
            <div className="kpi-v">{money(f.revenue)}</div>
            <div className="kpi-d muted">средний чек {f.ordered ? money(f.averageCheck) : '—'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">До заказа</div>
            <div className="kpi-v">{medianLabel}</div>
            <div className="kpi-d muted">от первого сообщения, медиана</div>
          </div>
        </div>

        <div className="an-grid">
          <section className="card card-p">
            <h2 className="card-t">Воронка</h2>
            <p className="tiny muted" style={{ marginBottom: 16 }}>Сколько клиентов дошло до каждого шага за {days} дней</p>
            <ol className="funnel">
              {steps.map((s, i) => (
                <li key={s.label}>
                  {i > 0 && <div className="funnel-conv">{pct(s.value, steps[i - 1]!.value)} от предыдущего шага</div>}
                  <div className="funnel-row">
                    <span className="funnel-l">{s.label}<span className="tiny muted">{s.hint}</span></span>
                    <span className="funnel-bar"><span style={{ width: `${(s.value / top) * 100}%` }} /></span>
                    <span className="funnel-v">{s.value}</span>
                  </div>
                </li>
              ))}
            </ol>
            {f.lost > 0 && (
              <p className="small" style={{ marginTop: 14 }}>
                Отказов: <b>{f.lost}</b> — {pct(f.lost, f.created)} от обращений
              </p>
            )}
          </section>

          <section className="card card-p">
            <h2 className="card-t">Почему отказываются</h2>
            {f.lostReasons.length === 0 ? (
              <p className="small muted">Отказов за период нет. Причина записывается, когда сделку переносят в «Отказ».</p>
            ) : (
              <ul className="reasons">
                {f.lostReasons.map(([reason, n]) => (
                  <li key={reason}>
                    <span className="reasons-l">{reason}</span>
                    <span className="funnel-bar funnel-bar-muted"><span style={{ width: `${(n / f.lostReasons[0]![1]) * 100}%` }} /></span>
                    <span className="funnel-v">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="an-grid">
          <section className="card card-p">
            <h2 className="card-t">Обращения по дням</h2>
            <DayBars data={chatsByDay} unit="обращений" />
          </section>
          <section className="card card-p">
            <h2 className="card-t">Заказы по дням</h2>
            <DayBars data={ordersByDay} unit="заказов" />
          </section>
        </div>

        {!seesOnlyOwn && (
          <div className="an-grid">
            <section className="card" style={{ overflowX: 'auto' }}>
              <div className="card-p" style={{ paddingBottom: 0 }}><h2 className="card-t">Менеджеры</h2></div>
              {managers.length === 0 ? (
                <p className="small muted card-p">Пока никому не передавали клиентов. Передать можно в карточке сделки.</p>
              ) : (
                <table>
                  <thead><tr><th>Менеджер</th><th className="num">Получил</th><th className="num">Заказов</th><th className="num">Конверсия</th><th className="num">Выручка</th></tr></thead>
                  <tbody>
                    {managers.map((m) => (
                      <tr key={m.name}>
                        <td style={{ fontWeight: 600 }}>{m.name}</td>
                        <td className="num">{m.assigned}</td>
                        <td className="num">{m.ordered}</td>
                        <td className="num">{pct(m.ordered, m.assigned)}</td>
                        <td className="num nowrap">{money(m.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card card-p">
              <h2 className="card-t">Ассистент</h2>
              <p className="tiny muted" style={{ marginBottom: 14 }}>Кто отвечал клиентам за период</p>
              <div className="share">
                <span style={{ flex: Math.max(aiShare, 1) }} />
                <span style={{ flex: Math.max(100 - aiShare, 1) }} />
              </div>
              <div className="spread small" style={{ marginTop: 10 }}>
                <span className="row"><span className="dot" style={{ color: 'var(--pine)' }} />Бот: {aiAnswers}</span>
                <span className="row"><span className="dot" style={{ color: 'var(--ink-3)' }} />Люди: {humanAnswers}</span>
              </div>
              <p className="tiny muted" style={{ marginTop: 12 }}>
                Бот ответил на {aiShare}% сообщений. Остальное — менеджеры: сложные вопросы и клиенты, которых передали.
              </p>
            </section>
          </div>
        )}
      </div>
    </Shell>
  );
}
