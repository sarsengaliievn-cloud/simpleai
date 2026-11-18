import Link from 'next/link';
import { funnel, isStale, sourceLabel, resolvePeriod, type StageKind } from '@wa/core';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { DayBars } from '@/components/DayBars';
import { money } from '@/lib/format';
import { loadDayTable } from '@/lib/day-analytics';

export const dynamic = 'force-dynamic';

const PERIODS: Array<[string, string]> = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней']];
const DAY = 24 * 60 * 60 * 1000;

type Props = { searchParams: Promise<{ d?: string; from?: string; to?: string }> };

export default async function AnalyticsPage({ searchParams }: Props) {
  const params = await searchParams;
  const ctx = await requireCompany('analytics:read');
  const { db, company, ownDeals, seesOnlyOwn } = ctx;
  const tz = company.timezone || 'Asia/Almaty';

  // Дни — календарные в поясе компании: «Сегодня» — с полуночи по Алматы.
  const period = resolvePeriod(params, tz);
  const { from, to } = period;
  const inPeriod = { gte: from, lt: to };
  const query = period.id === 'custom' ? `from=${period.fromKey}&to=${period.toKey}` : `d=${period.id}`;

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
      amount: true, lostReason: true, assigneeId: true, source: true, adHeadline: true, archiveReason: true,
      assignee: { select: { firstName: true, lastName: true } },
    },
  });
  const f = funnel(deals, from, to);

  // По дням — в часовом поясе компании, иначе ночные заявки уезжают во вчера.
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayName = (k: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${k}T00:00:00Z`));
  const weekday = (k: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${k}T00:00:00Z`));
  const keys = period.keys.map((key) => ({ key, label: dayName(key) }));
  const count = (pick: (x: (typeof deals)[number]) => Date | null) => {
    const map = new Map(keys.map((k) => [k.key, 0]));
    for (const x of deals) {
      const at = pick(x);
      if (at && at >= from && at < to) {
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

  // Откуда клиенты: напрямую в WhatsApp или с конкретной рекламы.
  const bySource = new Map<string, { label: string; ad: boolean; created: number; ordered: number; revenue: number }>();
  for (const x of deals) {
    const label = sourceLabel(x);
    const row = bySource.get(label) ?? { label, ad: x.source === 'ad', created: 0, ordered: 0, revenue: 0 };
    if (x.createdAt >= from) row.created += 1;
    if (x.orderedAt && x.orderedAt >= from) {
      row.ordered += 1;
      row.revenue += x.amount ?? 0;
    }
    bySource.set(label, row);
  }
  const sources = [...bySource.values()].filter((r) => r.created || r.ordered).sort((a, b) => b.created - a.created);

  // Зависшие прямо сейчас — по менеджерам: у кого клиенты без движения.
  const openDeals = seesOnlyOwn
    ? []
    : await db.deal.findMany({
        where: { assigneeId: { not: null }, archivedAt: null, stage: { kind: { notIn: ['WON', 'LOST'] } } },
        select: {
          assigneeId: true, stageChangedAt: true, remindAt: true,
          stage: { select: { kind: true } },
          conversation: { select: { lastMessageAt: true, mode: true } },
          assignee: { select: { firstName: true, lastName: true } },
        },
      });

  // По менеджерам: сколько получил, сколько довёл до заказа.
  const byManager = new Map<string, { name: string; assigned: number; ordered: number; revenue: number; stale: number }>();
  for (const x of deals) {
    if (!x.assigneeId) continue;
    const row = byManager.get(x.assigneeId) ?? {
      name: x.assignee ? `${x.assignee.firstName} ${x.assignee.lastName}`.trim() : 'Без имени',
      assigned: 0, ordered: 0, revenue: 0, stale: 0,
    };
    if (x.assignedAt && x.assignedAt >= from) row.assigned += 1;
    if (x.orderedAt && x.orderedAt >= from) {
      row.ordered += 1;
      row.revenue += x.amount ?? 0;
    }
    byManager.set(x.assigneeId, row);
  }
  for (const x of openDeals) {
    const stale = isStale(
      {
        stageKind: x.stage.kind as StageKind,
        stageChangedAt: x.stageChangedAt,
        lastMessageAt: x.conversation?.lastMessageAt,
        remindAt: x.remindAt,
        botActive: x.conversation?.mode === 'AI',
      },
      company.staleHours,
      to,
    );
    if (!stale || !x.assigneeId) continue;
    const row = byManager.get(x.assigneeId) ?? {
      name: x.assignee ? `${x.assignee.firstName} ${x.assignee.lastName}`.trim() : 'Без имени',
      assigned: 0, ordered: 0, revenue: 0, stale: 0,
    };
    row.stale += 1;
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

  // По дням. Склад подключён — заказы и выручка оттуда, и сверху тоже.
  const day = await loadDayTable(ctx, period);
  const sales = day.fromSklad
    ? { ordered: day.total.orders, won: day.total.completed, revenue: day.total.revenue, conversion: day.total.conversion ?? 0, avg: day.total.averageCheck ?? 0 }
    : { ordered: f.ordered, won: f.won, revenue: f.revenue, conversion: f.conversion, avg: f.averageCheck };
  const orderHint = day.fromSklad ? 'оплаченные заказы склада от клиентов WhatsApp' : 'этап с типом «Заказ» или «Купил»';
  if (day.fromSklad) {
    const byKey = new Map(day.rows.map((r) => [r.key, r.orders]));
    ordersByDay.splice(0, ordersByDay.length, ...keys.map((k) => ({ label: k.label, value: byKey.get(k.key) ?? 0 })));
  }

  const steps: Array<{ label: string; value: number; hint: string }> = [
    { label: 'Обращения', value: f.created, hint: 'клиент написал' },
    { label: 'Переданы менеджеру', value: f.assigned, hint: 'вы передали клиента' },
    { label: 'Заказы', value: sales.ordered, hint: orderHint },
    { label: 'Купили', value: sales.won, hint: day.fromSklad ? 'выкуплены в складе' : 'этап с типом «Купил»' },
  ];
  const pctNum = (v: number | null) => (v === null ? '—' : `${String(v).replace('.', ',')}%`);
  const top = Math.max(1, ...steps.map((s) => s.value));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <Shell
      ctx={ctx}
      title="Аналитика"
      hint={seesOnlyOwn ? 'Ваши клиенты: сколько пришло и сколько купили' : 'Сколько клиентов написало и сколько из них купило'}
      actions={
        <div className="an-period">
          <nav className="seg" aria-label="Период">
            {PERIODS.map(([n, text]) => (
              <Link key={n} href={`/analytics?d=${n}`} className={n === period.id ? 'on' : ''} aria-current={n === period.id ? 'page' : undefined}>
                {text}
              </Link>
            ))}
          </nav>
          <form className={`an-dates ${period.id === 'custom' ? 'on' : ''}`} action="/analytics" method="get">
            <input type="date" name="from" className="input" defaultValue={period.fromKey} aria-label="С даты" />
            <span className="muted">—</span>
            <input type="date" name="to" className="input" defaultValue={period.toKey} aria-label="По дату" />
            <button className="btn btn-sm" type="submit">Показать</button>
          </form>
        </div>
      }
    >
      <div className="page">
        <div className="kpis kpis-5">
          <div className="kpi">
            <div className="kpi-l">Обращений</div>
            <div className="kpi-v">{f.created}</div>
            <div className="kpi-d muted">{f.questions || f.spam ? `ещё ${f.questions} просто вопросов${f.spam ? `, ${f.spam} спам` : ''} — не в счёт` : 'новых сделок за период'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">Заказов</div>
            <div className="kpi-v">{sales.ordered}</div>
            <div className="kpi-d muted">{sales.won ? `${sales.won} уже ${day.fromSklad ? 'выкупили' : 'купили'}` : day.fromSklad ? 'оплаченные, из склада' : 'заказ или «Купил»'}</div>
          </div>
          <div className="kpi kpi-accent">
            <div className="kpi-l">Конверсия в заказ</div>
            <div className="kpi-v">{f.created ? `${String(sales.conversion).replace('.', ',')}%` : '—'}</div>
            <div className="kpi-d muted">заказы ÷ обращения</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">Выручка</div>
            <div className="kpi-v">{money(sales.revenue)}</div>
            <div className="kpi-d muted">средний чек {sales.ordered ? money(sales.avg) : '—'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">До заказа</div>
            <div className="kpi-v">{medianLabel}</div>
            <div className="kpi-d muted">от первого сообщения, медиана</div>
          </div>
        </div>

        <section className="card" style={{ overflowX: 'auto', marginBottom: 18 }}>
          <div className="card-p spread" style={{ paddingBottom: 0, alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h2 className="card-t">По дням</h2>
              <p className="tiny muted">
                Лиды — новые клиенты в WhatsApp (без «просто вопросов» и спама). Заказы — {orderHint}.
                Выкуплено и отменено — из заказов этого же дня.
              </p>
            </div>
            <a className="btn btn-sm" href={`/api/analytics/export?${query}`} download>Скачать Excel</a>
          </div>
          <table className="an-days">
            <thead>
              <tr>
                <th>День</th>
                <th className="num">Лиды</th>
                <th className="num" title="Пришли с рекламы Instagram / Facebook">из рекламы</th>
                <th className="num" title="Бот или менеджер ответили за 15 минут">ответ ≤15 мин</th>
                <th className="num" title="Никто так и не ответил">без ответа</th>
                <th className="num">Заказы</th>
                <th className="num">Сумма</th>
                <th className="num">Конверсия</th>
                <th className="num">Средний чек</th>
                <th className="num">Выкуплено</th>
                <th className="num" title="Отменены или вернулись">Отмена / возврат</th>
                <th className="num" title="Сделки, ушедшие в «Отказ»">Отказы</th>
              </tr>
            </thead>
            <tbody>
              {[...day.rows].reverse().map((r) => (
                <tr key={r.key} className={r.leads || r.orders ? '' : 'muted'}>
                  <td className="nowrap" style={{ fontWeight: 600 }}>{dayName(r.key)} <span className="tiny muted">{weekday(r.key)}</span></td>
                  <td className="num">{r.leads}</td>
                  <td className="num">{r.fromAds || ''}</td>
                  <td className="num">{r.leads ? `${r.answeredFast}` : ''}</td>
                  <td className={`num ${r.unanswered ? 'danger' : ''}`}>{r.unanswered || ''}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{r.orders}</td>
                  <td className="num nowrap">{r.revenue ? money(r.revenue) : ''}</td>
                  <td className="num">{pctNum(r.conversion)}</td>
                  <td className="num nowrap">{r.averageCheck ? money(r.averageCheck) : ''}</td>
                  <td className="num">{r.completed || ''}</td>
                  <td className="num">{r.cancelled || ''}</td>
                  <td className="num">{r.lost || ''}</td>
                </tr>
              ))}
            </tbody>
            {day.rows.length > 1 && (
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 700 }}>Итого</td>
                  <td className="num">{day.total.leads}</td>
                  <td className="num">{day.total.fromAds}</td>
                  <td className="num">{day.total.answeredFast}</td>
                  <td className="num">{day.total.unanswered}</td>
                  <td className="num">{day.total.orders}</td>
                  <td className="num nowrap">{money(day.total.revenue)}</td>
                  <td className="num">{pctNum(day.total.conversion)}</td>
                  <td className="num nowrap">{day.total.averageCheck ? money(day.total.averageCheck) : '—'}</td>
                  <td className="num">{day.total.completed}</td>
                  <td className="num">{day.total.cancelled}</td>
                  <td className="num">{day.total.lost}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>

        <div className="an-grid">
          <section className="card card-p">
            <h2 className="card-t">Воронка</h2>
            <p className="tiny muted" style={{ marginBottom: 16 }}>Сколько клиентов дошло до каждого шага — {period.label}</p>
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

        <section className="card" style={{ overflowX: 'auto', marginBottom: 18 }}>
          <div className="card-p" style={{ paddingBottom: 0 }}>
            <h2 className="card-t">Откуда клиенты</h2>
            <p className="tiny muted">
              Реклама «Написать в WhatsApp» в Instagram и Facebook определяется сама — по объявлению, с которого клиент нажал кнопку.
            </p>
          </div>
          {sources.length === 0 ? (
            <p className="small muted card-p">За период обращений не было.</p>
          ) : (
            <table>
              <thead><tr><th>Источник</th><th className="num">Обращений</th><th className="num">Заказов</th><th className="num">Конверсия</th><th className="num">Выручка</th></tr></thead>
              <tbody>
                {sources.map((r) => (
                  <tr key={r.label}>
                    <td style={{ fontWeight: 600 }}>
                      {r.ad && <span className="kan-tag tag-ad" style={{ marginRight: 6 }}>реклама</span>}
                      {r.label}
                    </td>
                    <td className="num">{r.created}</td>
                    <td className="num">{r.ordered}</td>
                    <td className="num">{pct(r.ordered, r.created)}</td>
                    <td className="num nowrap">{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

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
                  <thead><tr><th>Менеджер</th><th className="num">Получил</th><th className="num">Заказов</th><th className="num">Конверсия</th><th className="num">Выручка</th><th className="num" title={`Клиенты без движения больше ${company.staleHours} ч — сейчас`}>Зависли</th></tr></thead>
                  <tbody>
                    {managers.map((m) => (
                      <tr key={m.name}>
                        <td style={{ fontWeight: 600 }}>{m.name}</td>
                        <td className="num">{m.assigned}</td>
                        <td className="num">{m.ordered}</td>
                        <td className="num">{pct(m.ordered, m.assigned)}</td>
                        <td className="num nowrap">{money(m.revenue)}</td>
                        <td className={`num ${m.stale ? 'danger' : 'muted'}`}>
                          {m.stale ? <Link href="/deals?f=stale" className="danger">{m.stale}</Link> : 0}
                        </td>
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
