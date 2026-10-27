import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { isSuperAdmin } from '@/lib/admin';
import { KnowledgeUpload } from '@/components/KnowledgeUpload';
import { KnowledgeSearch } from '@/components/KnowledgeSearch';
import { AutoRefresh } from '@/components/AutoRefresh';
import { embedFamily, resolveAI } from '@wa/core';
import { ReindexBanner } from '@/components/ReindexBanner';
import { removeDocument } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = {
  READY: ['chip-ok', 'Готов'],
  PENDING: ['chip-warn', 'В очереди'],
  PROCESSING: ['chip-warn', 'Индексируется'],
  FAILED: ['chip-bad', 'Ошибка'],
};

export default async function KnowledgePage() {
  const { company, db, user, role } = await requireCompany('knowledge:manage');

  const docs = await db.knowledgeDocument.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const chunks = docs.reduce((sum, d) => sum + d.chunkCount, 0);
  const indexing = docs.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING');
  // Индекс построен другим AI-провайдером — поиск по нему вернёт мусор.
  const family = embedFamily(resolveAI(await db.aIConfiguration.findFirst()));
  const stale = docs.filter((d) => d.status === 'READY' && d.embedProvider && d.embedProvider !== family).length;

  return (
    <div className="shell">
      <Sidebar companyName={company.name} userName={`${user.firstName} ${user.lastName}`} role={role} balance={{ tiyn: company.balanceTiyn, lastTopup: company.lastTopupTiyn }} superAdmin={isSuperAdmin(user.email)} />
      <div className="main">
        <AutoRefresh active={indexing} />
        <header className="top">
          <div className="top-t"><h1>База знаний</h1><p className="top-hint">Отсюда бот берёт ответы: цены, размеры, доставка, адреса</p></div>
          <span className="chip" style={{ marginLeft: 'auto', flex: 'none' }}>
            {docs.length} документов · {chunks} фрагментов
          </span>
        </header>

        <div className="page">
          {stale > 0 && <ReindexBanner count={stale} provider={family === 'openai' ? 'ChatGPT (OpenAI)' : 'Gemini'} />}
          <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
            <div>
              <KnowledgeUpload />

              <div className="card" style={{ overflowX: 'auto', marginTop: 16 }}>
                {docs.length === 0 ? (
                  <div className="empty">
                    <h3>Ассистент пока ничего не знает о бизнесе</h3>
                    <p>
                      Загрузите прайс, условия доставки и правила возврата. Пока база пустая,
                      на любой вопрос он будет звать менеджера — так и задумано.
                    </p>
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Документ</th><th>Источник</th><th>Фрагментов</th><th>Статус</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map((d) => {
                        const [cls, label] = STATUS[d.status] ?? ['chip', d.status];
                        return (
                          <tr key={d.id}>
                            <td style={{ fontWeight: 600 }}>
                              {d.title}
                              {d.error && <div className="tiny" style={{ color: 'var(--red)' }}>{d.error}</div>}
                            </td>
                            <td className="muted small">{d.source}</td>
                            <td className="mono">{d.chunkCount}</td>
                            <td><span className={`chip ${cls}`}>{label}</span></td>
                            <td>
                              <form action={removeDocument.bind(null, d.id)}>
                                <button className="btn btn-quiet btn-sm" type="submit">Удалить</button>
                              </form>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <KnowledgeSearch />
          </div>
        </div>
      </div>
    </div>
  );
}
