import { can } from '@wa/core';
import { isWindowOpen } from '@wa/core';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { ConversationList } from '@/components/ConversationList';
import { ThreadView } from '@/components/ThreadView';
import { DealPanel } from '@/components/crm/DealPanel';
import { StartDeal } from '@/components/crm/StartDeal';
import { loadDeal, loadMembers, loadStages } from '@/lib/crm';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ id?: string; filter?: string; q?: string }> };

export default async function ConversationsPage({ searchParams }: Props) {
  const { id, filter = 'all', q = '' } = await searchParams;
  const ctx = await requireCompany();
  const { db, ownConversations, seesOnlyOwn } = ctx;

  const base =
    filter === 'unread' ? { unreadCount: { gt: 0 } }
    : filter === 'human' ? { mode: 'HUMAN' as const }
    : filter === 'new' ? { deals: { some: { stage: { kind: 'NEW' as const } } }, mode: 'HUMAN' as const, assigneeId: null }
    : filter === 'closed' ? { status: 'CLOSED' as const }
    : {};

  // Поиск по имени и номеру: в номере игнорируем пробелы, плюсы и скобки.
  const query = q.trim().slice(0, 60);
  const digits = query.replace(/\D/g, '');
  const where = {
    ...base,
    ...ownConversations,
    ...(query
      ? {
          customer: {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              ...(digits.length >= 3 ? [{ waId: { contains: digits } }] : []),
            ],
          },
        }
      : {}),
  };

  const conversations = await db.conversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take: 60,
    include: {
      customer: true,
      assignee: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      deals: { orderBy: { createdAt: 'desc' }, take: 1, include: { stage: true } },
    },
  });

  const activeId = id ?? conversations[0]?.id ?? null;

  const active = activeId
    ? await db.conversation.findFirst({
        where: { id: activeId, ...ownConversations },
        include: {
          customer: true,
          messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      })
    : null;

  const [stages, deal, members] = active
    ? await Promise.all([
        loadStages(db),
        loadDeal(db, { customerId: active.customer.id }),
        can(ctx.role, 'team:manage') ? loadMembers(db) : Promise.resolve(null),
      ])
    : [[], null, null];

  return (
    <Shell
      ctx={ctx}
      title="Диалоги"
      hint={seesOnlyOwn ? 'Клиенты, которых вам передали' : 'Переписка с клиентами. Справа — сделка: этап, менеджер, заказ'}
    >
      <div className="inbox">
        <ConversationList
          filter={filter}
          query={query}
          activeId={activeId}
          showNew={!seesOnlyOwn}
          items={conversations.map((c) => ({
            id: c.id,
            name: c.customer.name ?? `+${c.customer.waId}`,
            preview: c.messages[0]?.text ?? 'Вложение',
            lastMessageAt: c.lastMessageAt,
            unread: c.unreadCount,
            mode: c.mode,
            status: c.status,
            stage: c.deals[0] ? { name: c.deals[0].stage.name, kind: c.deals[0].stage.kind } : null,
            assignee: c.assignee ? c.assignee.firstName : null,
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
              status: m.status,
              errorCode: m.errorCode,
              createdAt: m.createdAt,
              fromPhone: (m.metadata as { source?: string } | null)?.source === 'phone',
            }))}
          />
        ) : (
          <div className="empty" style={{ alignSelf: 'center' }}>
            <h3>{seesOnlyOwn ? 'Вам пока не передали клиентов' : 'Пока ни одного диалога'}</h3>
            <p>
              {seesOnlyOwn
                ? 'Когда владелец передаст вам клиента, его переписка появится здесь.'
                : 'Как только клиент напишет на подключённый номер WhatsApp, переписка появится здесь, а в «Сделках» — его карточка.'}
            </p>
          </div>
        )}

        {active && (
          <aside className="ctx">
            {deal ? (
              <DealPanel key={deal.id} deal={deal} stages={stages} members={members} />
            ) : (
              <StartDeal conversationId={active.id} />
            )}
          </aside>
        )}
      </div>
    </Shell>
  );
}
