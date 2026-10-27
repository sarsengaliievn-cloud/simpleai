import { billingSettings, balanceLow, formatTiyn, aiLabel, resolveAI } from '@wa/core';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { DayBars } from '@/components/DayBars';
import { TopupForm } from '@/components/TopupForm';
import { agoText, clockWithDay } from '@/lib/format';

export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60 * 1000;
const DAYS = 30;

const KIND: Record<string, string> = {
  reply: 'Ответы клиентам',
  playground: 'Тестовый чат и проверка поиска',
  knowledge: 'База знаний (загрузка документов)',
  voice: 'Расшифровка голосовых',
};
const TX: Record<string, string> = { topup: 'Пополнение', bonus: 'Бонус', adjust: 'Корректировка' };
const REQ: Record<string, [string, string]> = { open: ['chip-warn', 'Ждёт зачисления'], done: ['chip-ok', 'Зачислено'], rejected: ['chip-bad', 'Отклонена'] };

export default async function BillingPage() {
  const ctx = await requireCompany('settings:manage');
  const { db, company } = ctx;
  const since = new Date(Date.now() - DAYS * DAY);

  const [usage, txs, requests, settings, config] = await Promise.all([
    db.aiUsage.findMany({ where: { createdAt: { gte: since } }, select: { kind: true, chargeTiyn: true, createdAt: true } }),
    db.balanceTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    db.topupRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    billingSettings(),
    db.aIConfiguration.findFirst(),
  ]);

  const balance = company.balanceTiyn;
  const low = balanceLow(balance, company.lastTopupTiyn);
  const spent30 = usage.reduce((s, u) => s + u.chargeTiyn, 0);

  // Прогноз — по последним 14 дням: старые дни хуже отражают текущий поток клиентов.
  const recent = usage.filter((u) => u.createdAt.getTime() > Date.now() - 14 * DAY).reduce((s, u) => s + u.chargeTiyn, 0);
  const perDay = recent / 14;
  const daysLeft = balance > 0 && perDay > 0 ? Math.floor(balance / perDay) : null;

  const replies = usage.filter((u) => u.kind === 'reply');
  const perReply = replies.length ? Math.round(replies.reduce((s, u) => s + u.chargeTiyn, 0) / replies.length) : null;

  const byKind = Object.keys(KIND).map((k) => {
    const list = usage.filter((u) => u.kind === k);
    return { kind: k, count: list.length, sum: list.reduce((s, u) => s + u.chargeTiyn, 0) };
  });

  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: company.timezone || 'Asia/Almaty' });
  const dayLabel = new Intl.DateTimeFormat('ru-RU', { timeZone: company.timezone || 'Asia/Almaty', day: 'numeric', month: 'short' });
  const days = Array.from({ length: DAYS }, (_, i) => new Date(Date.now() - (DAYS - 1 - i) * DAY));
  const sums = new Map(days.map((d) => [dayKey.format(d), 0]));
  for (const u of usage) {
    const k = dayKey.format(u.createdAt);
    if (sums.has(k)) sums.set(k, sums.get(k)! + u.chargeTiyn);
  }
  const series = days.map((d) => ({ label: dayLabel.format(d), value: sums.get(dayKey.format(d)) ?? 0 }));
  const ai = aiLabel(resolveAI(config));

  return (
    <Shell ctx={ctx} title="Баланс ИИ" hint="Каждый ответ бота списывает стоимость с баланса. Закончится — бот передаст клиентов менеджерам">
      <div className="page" style={{ maxWidth: 1100 }}>
        <div className="bill-top">
          <section className={`card card-p bill-balance ${balance <= 0 ? 'empty' : low ? 'low' : ''}`}>
            <div className="small muted">Осталось</div>
            <div className="bill-amount">{formatTiyn(balance)}</div>
            <div className="small">
              {balance <= 0
                ? 'Бот не отвечает клиентам — все новые сообщения уходят менеджерам.'
                : daysLeft !== null
                  ? daysLeft > 365
                    ? 'При нынешнем потоке клиентов хватит больше чем на год'
                    : `Хватит примерно на ${daysLeft} дн. при нынешнем потоке клиентов`
                  : 'Расходов за последние две недели не было'}
            </div>
            {low && balance > 0 && <div className="small" style={{ marginTop: 6, fontWeight: 600 }}>Осталось меньше 10% от последнего пополнения</div>}
          </section>

          <section className="card card-p bill-facts">
            <div><span className="small muted">Потрачено за 30 дней</span><b>{formatTiyn(spent30)}</b></div>
            <div><span className="small muted">Ответ бота в среднем</span><b>{perReply !== null ? formatTiyn(perReply) : '—'}</b></div>
            <div><span className="small muted">Отвечает</span><b>{ai.provider} · {ai.model}</b></div>
          </section>
        </div>

        <div className="an-grid">
          <section className="card card-p">
            <h2 className="card-t">Расход по дням</h2>
            <DayBars data={series} unit="списано" money />
          </section>
          <section className="card card-p">
            <h2 className="card-t">На что ушло за 30 дней</h2>
            <table style={{ marginTop: 6 }}>
              <tbody>
                {byKind.map((k) => (
                  <tr key={k.kind}>
                    <td style={{ paddingLeft: 0 }}>{KIND[k.kind]}<div className="tiny muted">{k.count} раз</div></td>
                    <td className="num nowrap" style={{ paddingRight: 0, fontWeight: 600 }}>{formatTiyn(k.sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="an-grid">
          <section className="card card-p">
            <h2 className="card-t">Пополнить</h2>
            <p className="small" style={{ margin: '4px 0 16px', whiteSpace: 'pre-line', maxWidth: '62ch' }}>{settings.topupInstructions}</p>
            <TopupForm />
            {requests.length > 0 && (
              <ul className="req-list">
                {requests.map((r) => {
                  const [cls, label] = REQ[r.status] ?? ['chip', r.status];
                  return (
                    <li key={r.id}>
                      <span style={{ fontWeight: 600 }}>{formatTiyn(r.amountTiyn)}</span>
                      <span className="tiny muted">{agoText(r.createdAt)}</span>
                      <span className={`chip ${cls}`} style={{ marginLeft: 'auto' }}>{label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card" style={{ overflowX: 'auto' }}>
            <div className="card-p" style={{ paddingBottom: 0 }}><h2 className="card-t">Пополнения и бонусы</h2></div>
            {txs.length === 0 ? (
              <p className="small muted card-p">Пока пополнений не было.</p>
            ) : (
              <table>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td className="small nowrap" suppressHydrationWarning>{clockWithDay(t.createdAt)}</td>
                      <td className="small">{TX[t.kind] ?? t.kind}{t.note ? <div className="tiny muted">{t.note}</div> : null}</td>
                      <td className={`num nowrap ${t.amountTiyn < 0 ? 'danger' : ''}`} style={{ fontWeight: 600 }}>
                        {t.amountTiyn > 0 ? '+' : ''}{formatTiyn(t.amountTiyn)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}
