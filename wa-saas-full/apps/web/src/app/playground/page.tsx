import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { isSuperAdmin } from '@/lib/admin';
import { Playground } from '@/components/Playground';

export const dynamic = 'force-dynamic';

export default async function PlaygroundPage() {
  const { company, db, user, role } = await requireCompany('ai:manage');
  const config = await db.aIConfiguration.findFirst();
  const docs = await db.knowledgeDocument.count({ where: { status: 'READY' } });

  return (
    <div className="shell">
      <Sidebar companyName={company.name} userName={`${user.firstName} ${user.lastName}`} role={role} balance={{ tiyn: company.balanceTiyn, lastTopup: company.lastTopupTiyn }} superAdmin={isSuperAdmin(user.email)} />
      <div className="main">
        <header className="top">
          <div className="top-t"><h1>Тестовый чат</h1><p className="top-hint">Задайте вопрос как клиент и посмотрите, что ответит бот</p></div>
          <span className="chip" style={{ marginLeft: 'auto', flex: 'none' }}>сообщения не уходят в WhatsApp</span>
        </header>
        <Playground
          tone={config?.tone ?? 'не настроен'}
          threshold={config?.confidenceThreshold ?? 70}
          documents={docs}
        />
      </div>
    </div>
  );
}
