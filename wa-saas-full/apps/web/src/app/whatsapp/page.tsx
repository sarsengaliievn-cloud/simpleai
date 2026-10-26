import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { ConnectSection } from '@/components/ConnectSection';
import { disconnectNumber } from './actions';
import { timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = {
  CONNECTED: ['chip-ok', 'Подключён'],
  PENDING: ['chip-warn', 'Ожидает'],
  ERROR: ['chip-bad', 'Ошибка'],
  DISCONNECTED: ['chip', 'Отключён'],
};

export default async function WhatsAppPage() {
  const { company, db, user } = await requireCompany();

  const numbers = await db.whatsAppPhoneNumber.findMany({
    orderBy: { createdAt: 'asc' },
    include: { account: true },
  });

  const lastEvent = await db.message.findFirst({
    where: { direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  return (
    <div className="shell">
      <Sidebar companyName={company.name} userName={`${user.firstName} ${user.lastName}`} />
      <div className="main">
        <header className="top">
          <h1>WhatsApp</h1>
          <span className="chip" style={{ marginLeft: 'auto' }}>{numbers.length} номеров</span>
        </header>

        <div className="page page-narrow">
          {numbers.length === 0 && (
            <div className="empty" style={{ marginBottom: 16 }}>
              <h3>Номер не подключён</h3>
              <p>Пока номера нет, ассистента можно проверять только в тестовом чате.</p>
            </div>
          )}

          {numbers.map((n) => {
            const [cls, label] = STATUS[n.status] ?? ['chip', n.status];
            return (
              <div className="card card-p" style={{ marginBottom: 16 }} key={n.id}>
                <div className="spread" style={{ marginBottom: 18 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{n.verifiedName ?? company.name}</div>
                    <div className="small muted mono">{n.displayPhoneNumber}</div>
                  </div>
                  <span className={`chip ${cls}`}><span className="dot" />{label}</span>
                </div>

                {([
                  ['WhatsApp Business Account ID', n.account.wabaId],
                  ['Phone Number ID', n.phoneNumberId],
                  ['Качество номера', n.qualityRating ?? 'нет данных'],
                  ['Лимит отправки', n.messagingLimit ?? 'нет данных'],
                  ['Способ подключения', n.account.connectedVia === 'MANUAL' ? 'вручную (WABA клиента)' : 'через Meta'],
                  ['Токен', '••••••••'],
                  ['Последнее входящее', lastEvent ? `${timeAgo(lastEvent.createdAt)} назад` : 'ещё не было'],
                ] as Array<[string, string]>).map(([k, v]) => (
                  <div className="spread" style={{ padding: '11px 0', borderTop: '1px solid var(--line)' }} key={k}>
                    <span className="small muted">{k}</span>
                    <span className="small mono" style={{ fontWeight: 600 }}>{v}</span>
                  </div>
                ))}

                {n.status !== 'DISCONNECTED' && (
                  <form action={disconnectNumber.bind(null, n.id)} style={{ marginTop: 16 }}>
                    <button className="btn btn-quiet btn-sm" style={{ color: 'var(--red)' }} type="submit">
                      Отключить
                    </button>
                  </form>
                )}
              </div>
            );
          })}

          <ConnectSection
            appId={process.env.META_APP_ID ?? ''}
            configId={process.env.META_CONFIG_ID ?? ''}
          />

          <div className="card card-p" style={{ background: 'var(--amber-soft)', borderColor: 'transparent', marginTop: 16 }}>
            <div style={{ fontWeight: 700, color: 'var(--amber)', marginBottom: 8 }}>Про окно в 24 часа</div>
            <p className="small" style={{ color: 'var(--ink-2)' }}>
              Свободным текстом можно отвечать 24 часа после последнего сообщения клиента.
              Позже — только шаблоном, утверждённым Meta. Платформа следит за этим сама
              и не даст отправить то, что приведёт к падению качества номера.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
