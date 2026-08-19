import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { saveCompany } from './actions';
import { timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

const ACTIONS: Record<string, string> = {
  'company.updated': 'Изменены данные компании',
  'ai.config.updated': 'Изменены настройки ассистента',
  'whatsapp.number.connected': 'Подключён номер WhatsApp',
  'whatsapp.number.disconnected': 'Отключён номер WhatsApp',
};

export default async function SettingsPage() {
  const { company, db } = await requireCompany();

  const logs = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });

  return (
    <div className="shell">
      <Sidebar companyName={company.name} />
      <div className="main">
        <header className="top"><h1>Настройки</h1></header>

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
                      <td className="muted small" style={{ width: 130 }}>{timeAgo(log.createdAt)} назад</td>
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
