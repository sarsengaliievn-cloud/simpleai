import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { Playground } from '@/components/Playground';

export const dynamic = 'force-dynamic';

export default async function PlaygroundPage() {
  const { company, db, user } = await requireCompany();
  const config = await db.aIConfiguration.findFirst();
  const docs = await db.knowledgeDocument.count({ where: { status: 'READY' } });

  return (
    <div className="shell">
      <Sidebar companyName={company.name} userName={`${user.firstName} ${user.lastName}`} />
      <div className="main">
        <header className="top">
          <h1>Тестовый чат</h1>
          <span className="chip" style={{ marginLeft: 'auto' }}>сообщения не уходят в WhatsApp</span>
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
