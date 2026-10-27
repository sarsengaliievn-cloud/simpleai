import Link from 'next/link';
import { prisma } from '@wa/db';
import { billingSettings, formatTiyn, MODELS, modelInfo, balanceLow } from '@wa/core';
import { requireSuperAdmin } from '@/lib/admin';
import { agoText } from '@/lib/format';
import { CreditForm, SettingsForm } from '@/components/AdminForms';
import { resolveTopup } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Платформа — SaudaBot' };

const DAY = 24 * 60 * 60 * 1000;

export default async function AdminPage() {
  const admin = await requireSuperAdmin();
  const since = new Date(Date.now() - 30 * DAY);

  const [companies, usage, requests, settings] = await Promise.all([
    prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        memberships: { where: { role: 'OWNER' }, include: { user: { select: { email: true } } }, take: 1 },
        whatsappNumbers: { select: { displayPhoneNumber: true } },
      },
    }),
    prisma.aiUsage.groupBy({ by: ['companyId'], where: { createdAt: { gte: since } }, _sum: { chargeTiyn: true, costMicroUsd: true }, _count: true }),
    prisma.topupRequest.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'asc' }, include: { company: { select: { name: true, balanceTiyn: true } } } }),
    billingSettings(),
  ]);

  const byCompany = new Map(usage.map((u) => [u.companyId, u]));
  // Себестоимость переводим в тиыны по текущему курсу, чтобы сравнивать с выручкой.
  const costTiyn = (micro: number) => Math.round((micro / 1e6) * settings.usdKzt * 100);
  const revenue = usage.reduce((s, u) => s + (u._sum.chargeTiyn ?? 0), 0);
  const cost = usage.reduce((s, u) => s + costTiyn(u._sum.costMicroUsd ?? 0), 0);
  const balances = companies.reduce((s, c) => s + Math.max(0, c.balanceTiyn), 0);

  return (
    <div className="main" style={{ minHeight: "100vh" }}>
      <header className="top">
        <div className="top-t">
          <h1>Платформа SaudaBot</h1>
          <p className="top-hint">Все компании, их баланс ИИ, заявки на пополнение и цены. Видите только вы — {admin.email}</p>
        </div>
        <div className="top-a"><Link className="btn" href="/conversations">← В свою панель</Link></div>
      </header>

      <div className="page" style={{ maxWidth: 1200 }}>
        <div className="adm-kpis">
          <div className="card adm-kpi"><span className="small muted">Компаний</span><b>{companies.length}</b></div>
          <div className="card adm-kpi"><span className="small muted">Списано с клиентов за 30 дн.</span><b>{formatTiyn(revenue)}</b></div>
          <div className="card adm-kpi"><span className="small muted">Себестоимость ИИ за 30 дн.</span><b>{formatTiyn(cost)}</b></div>
          <div className="card adm-kpi"><span className="small muted">Заработок · на балансах</span><b>{formatTiyn(revenue - cost)}</b><span className="tiny muted">{formatTiyn(balances)} лежит на балансах</span></div>
        </div>

        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-p" style={{ paddingBottom: 0 }}>
            <h2 className="card-t">Заявки на пополнение {requests.length > 0 && <span className="chip chip-warn">{requests.length}</span>}</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>Проверьте оплату в Kaspi и нажмите «Зачислить» — сумма сразу попадёт на баланс компании.</p>
          </div>
          {requests.length === 0 ? (
            <p className="small muted card-p">Новых заявок нет.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.company.name}</b><div className="tiny muted">сейчас на балансе {formatTiyn(r.company.balanceTiyn)}</div></td>
                      <td className="num nowrap" style={{ fontWeight: 700 }}>{formatTiyn(r.amountTiyn)}</td>
                      <td className="small">{r.comment ?? <span className="muted">без комментария</span>}<div className="tiny muted">{agoText(r.createdAt)}</div></td>
                      <td className="nowrap" style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <form action={resolveTopup}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="decision" value="approve" />
                            <button className="btn btn-primary btn-sm" type="submit">Зачислить {formatTiyn(r.amountTiyn)}</button>
                          </form>
                          <form action={resolveTopup}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="decision" value="reject" />
                            <button className="btn btn-quiet btn-sm danger" type="submit">Отклонить</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" style={{ marginBottom: 16, overflowX: 'auto' }}>
          <div className="card-p" style={{ paddingBottom: 0 }}><h2 className="card-t">Компании</h2></div>
          <table>
            <thead>
              <tr><th>Компания</th><th className="num">Баланс</th><th className="num">Расход 30 дн.</th><th className="num">Себест.</th><th>Пополнить</th></tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const u = byCompany.get(c.id);
                const charged = u?._sum.chargeTiyn ?? 0;
                const low = c.balanceTiyn <= 0 ? 'danger' : balanceLow(c.balanceTiyn, c.lastTopupTiyn) ? 'warn-t' : '';
                return (
                  <tr key={c.id}>
                    <td>
                      <b>{c.name}</b>
                      <div className="tiny muted">
                        {c.memberships[0]?.user.email ?? 'без владельца'}
                        {c.whatsappNumbers.length > 0 && ` · ${c.whatsappNumbers.map((n) => n.displayPhoneNumber).join(', ')}`}
                        {` · с ${c.createdAt.toLocaleDateString('ru-RU')}`}
                      </div>
                    </td>
                    <td className={`num nowrap ${low}`} style={{ fontWeight: 700 }}>{formatTiyn(c.balanceTiyn)}</td>
                    <td className="num nowrap">{formatTiyn(charged)}<div className="tiny muted">{u?._count ?? 0} запросов</div></td>
                    <td className="num nowrap small muted">{formatTiyn(costTiyn(u?._sum.costMicroUsd ?? 0))}</td>
                    <td><CreditForm companyId={c.id} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card card-p">
          <h2 className="card-t">Цены и оплата</h2>
          <p className="small muted" style={{ margin: '4px 0 16px', maxWidth: '70ch' }}>
            Клиент платит: себестоимость модели × курс × наценка. Сейчас ответ бота на Gemini 3.6 Flash обходится клиенту примерно в{' '}
            {formatTiyn(Math.max(1, Math.ceil(((2500 * (modelInfo('gemini-3.6-flash', settings)?.inUsd ?? 0) + 250 * (modelInfo('gemini-3.6-flash', settings)?.outUsd ?? 0)) / 1e6) * settings.usdKzt * settings.markup * 100)))}.
          </p>
          <SettingsForm
            settings={settings}
            models={MODELS.map((m) => {
              const cur = modelInfo(m.id, settings)!;
              return { id: m.id, label: m.label, inUsd: cur.inUsd, outUsd: cur.outUsd, baseIn: m.inUsd, baseOut: m.outUsd };
            })}
          />
        </section>
      </div>
    </div>
  );
}
