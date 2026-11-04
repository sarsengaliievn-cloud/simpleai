import { requireCompany } from '@/lib/session';
import { sidebarExtras } from '@/lib/sidebar';
import { Sidebar } from '@/components/Sidebar';
import { isSuperAdmin } from '@/lib/admin';
import { saveCompany, addQuickReply, deleteQuickReply } from './actions';
import { timeAgo, agoText } from '@/lib/format';

export const dynamic = 'force-dynamic';

const ACTIONS: Record<string, string> = {
  'company.updated': 'Изменены данные компании',
  'ai.config.updated': 'Изменены настройки ассистента',
  'whatsapp.number.connected': 'Подключён номер WhatsApp',
  'whatsapp.number.disconnected': 'Отключён номер WhatsApp',
};

export default async function SettingsPage() {
  const ctx = await requireCompany('settings:manage');
  const { company, db, user, role } = ctx;
  const extras = await sidebarExtras(ctx);

  const [logs, quick] = await Promise.all([
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    db.quickReply.findMany({ orderBy: { position: 'asc' } }),
  ]);

  return (
    <div className="shell">
      <Sidebar companyName={company.name} userName={`${user.firstName} ${user.lastName}`} role={role} balance={{ tiyn: company.balanceTiyn, lastTopup: company.lastTopupTiyn, exempt: company.billingExempt }} superAdmin={isSuperAdmin(user.email)} aiError={company.aiError} {...extras} />
      <div className="main">
        <header className="top"><div className="top-t"><h1>Настройки</h1><p className="top-hint">Данные компании и журнал изменений</p></div></header>

        <div className="page page-narrow">
          <form action={saveCompany} className="card card-p" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 16 }}>Компания</div>

            <label className="field">
              <span className="label">Название</span>
              <input className="input" name="name" defaultValue={company.name} />
            </label>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="field">
                <span className="label">Город</span>
                <input className="input" name="city" defaultValue={company.city ?? ''} />
              </label>
              <label className="field">
                <span className="label">Страна</span>
                <input className="input" name="country" defaultValue={company.country ?? ''} />
              </label>
            </div>

            <label className="field">
              <span className="label">Сайт</span>
              <input className="input" name="website" defaultValue={company.website ?? ''} />
            </label>

            <label className="field">
              <span className="label">Чем занимаетесь</span>
              <textarea className="textarea" name="description" defaultValue={company.description ?? ''} />
              <span className="hint">Этот текст попадает в инструкцию ассистента — он опирается на него, когда клиент спрашивает «а вы кто?».</span>
            </label>

            <button className="btn btn-primary" type="submit">Сохранить</button>
          </form>

          <section className="card card-p" style={{ marginBottom: 16 }} id="quick">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Быстрые ответы</div>
            <p className="small muted" style={{ marginBottom: 14 }}>
              Тексты, которые менеджеры отправляют чаще всего: ссылка на каталог, акции, адреса, реквизиты.
              В переписке — кнопка ⚡ или «/» в начале сообщения.
            </p>
            {quick.length > 0 && (
              <ul className="qr-list">
                {quick.map((q) => (
                  <li key={q.id}>
                    <div style={{ minWidth: 0 }}>
                      <b>{q.title}</b>
                      <div className="small muted qr-text">{q.text}</div>
                    </div>
                    <form action={deleteQuickReply}>
                      <input type="hidden" name="id" value={q.id} />
                      <button className="btn btn-quiet btn-sm danger" type="submit">Удалить</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addQuickReply}>
              <label className="field">
                <span className="label">Название</span>
                <input className="input" name="title" required maxLength={60} placeholder="Каталог и акция" />
              </label>
              <label className="field">
                <span className="label">Текст</span>
                <textarea className="textarea" name="text" required maxLength={4000} style={{ minHeight: 90 }}
                          placeholder="https://sklad-obuv.web.app/shop/ — каталогтан өз размеріңізді таңдап, маған жіберіңіз…" />
              </label>
              <button className="btn" type="submit">Добавить ответ</button>
            </form>
          </section>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-p" style={{ borderBottom: '1px solid var(--line)', fontWeight: 700 }}>
              Журнал действий
            </div>
            {logs.length === 0 ? (
              <div className="empty">
                <p>Пока пусто. Сюда попадают изменения настроек, подключения номеров и правки ассистента.</p>
              </div>
            ) : (
              <table>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="muted small" style={{ width: 130 }}>{agoText(log.createdAt)}</td>
                      <td className="small">{ACTIONS[log.action] ?? log.action}</td>
                      <td className="tiny muted mono">{log.entityId?.slice(0, 8) ?? ''}</td>
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
