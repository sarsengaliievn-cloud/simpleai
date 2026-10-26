import { requireCompany } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { ConversationList } from '@/components/ConversationList';
import { ThreadView } from '@/components/ThreadView';
import { isWindowOpen } from '@wa/core';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ id?: string; filter?: string; q?: string }> };

export default async function ConversationsPage({ searchParams }: Props) {
  const { id, filter = 'all', q = '' } = await searchParams;
  const { company, db, user } = await requireCompany();

  const base =
    filter === 'unread' ? { unreadCount: { gt: 0 } }
    : filter === 'human' ? { mode: 'HUMAN' as const }
    : filter === 'closed' ? { status: 'CLOSED' as const }
    : {};

  // Поиск по имени и номеру: в номере игнорируем пробелы, плюсы и скобки.
  const query = q.trim().slice(0, 60);
  const digits = query.replace(/\D/g, '');
  const where = query
    ? {
        ...base,
        customer: {
          OR: [
            { name: { contains: query, mode: 'insensitive' as const } },
            ...(digits.length >= 3 ? [{ waId: { contains: digits } }] : []),
          ],
        },
      }
    : base;

  const conversations = await db.conversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    include: {
      customer: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const activeId = id ?? conversations[0]?.id ?? null;

  const active = activeId
    ? await db.conversation.findFirst({
        where: { id: activeId },
        include: {
          customer: true,
          messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      })
    : null;

  return (
    <div className="shell">
      <Sidebar companyName={company.name} userName={`${user.firstName} ${user.lastName}`} />
      <div className="main">
        <header className="top">
          <h1>Диалоги</h1>
          <span className="chip" style={{ marginLeft: 'auto' }}>
            {conversations.length} в списке
          </span>
        </header>

        <div className="inbox">
          <ConversationList
            filter={filter}
            query={query}
            activeId={activeId}
            items={conversations.map((c) => ({
              id: c.id,
              name: c.customer.name ?? `+${c.customer.waId}`,
              preview: c.messages[0]?.text ?? 'Вложение',
              lastMessageAt: c.lastMessageAt,
              unread: c.unreadCount,
              mode: c.mode,
              status: c.status,
            }))}
          />

          {active ? (
            <ThreadView
              conversation={{
                id: active.id,
                mode: active.mode,
                windowOpen: isWindowOpen(active.windowExpiresAt),
                windowExpiresAt: active.windowExpiresAt,
                customerName: active.customer.name ?? `+${active.customer.waId}`,
                customerPhone: active.customer.phone,
                customerCity: active.customer.city,
              }}
              messages={active.messages.map((m) => ({
                id: m.id,
                direction: m.direction,
                authorType: m.authorType,
                text: m.text,
                type: m.type,
                createdAt: m.createdAt,
              }))}
            />
          ) : (
            <div className="empty" style={{ alignSelf: 'center' }}>
              <h3>Пока ни одного диалога</h3>
              <p>
                Как только клиент напишет на подключённый номер, переписка появится здесь.
                Для проверки можно отправить тестовое событие на вебхук — команда в README.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
