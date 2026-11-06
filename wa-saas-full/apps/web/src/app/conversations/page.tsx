import Link from 'next/link';
import { can, lostReasonsOf } from '@wa/core';
import { loadThread } from '@/lib/thread';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { ConversationList } from '@/components/ConversationList';
import { ThreadView } from '@/components/ThreadView';
import { DealPanel } from '@/components/crm/DealPanel';
import { StartDeal } from '@/components/crm/StartDeal';
import { loadDeal, loadMembers, loadStages, purchaseCounts } from '@/lib/crm';

export const dynamic = 'force-dynamic';

const ATTACH_PREVIEW: Record<string, string> = {
  IMAGE: '📷 Фото', VIDEO: '🎥 Видео', DOCUMENT: '📄 Файл', AUDIO: '🎤 Голосовое', LOCATION: '📍 Геолокация', UNSUPPORTED: 'Стикер или реакция',
};

type Props = { searchParams: Promise<{ id?: string; filter?: string; q?: string; deal?: string }> };

export default async function ConversationsPage({ searchParams }: Props) {
  const { id, filter: rawFilter = 'open', q = '', deal: showDeal } = await searchParams;
  const ctx = await requireCompany();
  const { db, ownConversations, seesOnlyOwn, user } = ctx;
  // Старые ссылки «Все» ведут в открытые: закрытые копились и мешали.
  const filter = ['open', 'new', 'mine', 'unread', 'closed'].includes(rawFilter) ? rawFilter : 'open';

  const notClosed = { status: { not: 'CLOSED' as const } };
  const base =
    filter === 'unread' ? { ...notClosed, unreadCount: { gt: 0 } }
    : filter === 'new' ? { ...notClosed, deals: { some: { archivedAt: null, stage: { kind: 'NEW' as const } } }, mode: 'HUMAN' as const, assigneeId: null }
    : filter === 'mine' ? { ...notClosed, OR: [{ assigneeId: user.id }, { deals: { some: { assigneeId: user.id, archivedAt: null } } }] }
    : filter === 'closed' ? { status: 'CLOSED' as const }
    : notClosed;

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

  const bought = await purchaseCounts(db, conversations.map((c) => c.customerId));

  // Мусор в ?id= (старая ссылка, «undefined») раньше ронял страницу ошибкой базы.
  const validId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
  const activeId = validId ?? conversations[0]?.id ?? null;

  const active = activeId ? await loadThread(db, { id: activeId, ...ownConversations }) : null;

  const quickReplies = active ? await db.quickReply.findMany({ orderBy: { position: 'asc' }, select: { id: true, title: true, text: true } }) : [];

  const [stages, deal, members] = active
    ? await Promise.all([
        loadStages(db),
        loadDeal(db, { customerId: active.customerId }),
        can(ctx.role, 'team:manage') ? loadMembers(db) : Promise.resolve(null),
      ])
    : [[], null, null];

  return (
    <Shell
      ctx={ctx}
      title="Диалоги"
      hint={seesOnlyOwn ? 'Клиенты, которых вам передали' : 'Переписка с клиентами. Справа — сделка: этап, менеджер, заказ'}
    >
      <div className={`inbox ${validId ? 'has-open' : 'no-open'}`}>
        <ConversationList
          filter={filter}
          query={query}
          activeId={activeId}
          showNew={!seesOnlyOwn}
          items={conversations.map((c) => ({
            id: c.id,
            name: c.customer.name || `+${c.customer.waId}`,
            preview: c.messages[0]?.text ?? ATTACH_PREVIEW[c.messages[0]?.type ?? ''] ?? 'Вложение',
            lastMessageAt: c.lastMessageAt,
            unread: c.unreadCount,
            mode: c.mode,
            status: c.status,
            stage: c.deals[0] ? { name: c.deals[0].stage.name, kind: c.deals[0].stage.kind } : null,
            assignee: c.assignee ? c.assignee.firstName : null,
            repeat: (bought.get(c.customerId) ?? 0) - (c.deals[0]?.wonAt ? 1 : 0),
            ad: c.deals[0]?.source === 'ad',
          }))}
        />

        {active ? (
          <ThreadView
            key={active.conversation.id}
            quickReplies={quickReplies}
            backHref={`/conversations?${new URLSearchParams({ filter, ...(query ? { q: query } : {}) })}`}
            dealHref={`/conversations?${new URLSearchParams({ filter, ...(query ? { q: query } : {}), id: active.conversation.id, deal: '1' })}`}
            lostReasons={lostReasonsOf(ctx.company)}
            conversation={active.conversation}
            messages={active.messages}
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

        {active && showDeal && (
          <Link
            href={`/conversations?${new URLSearchParams({ filter, ...(query ? { q: query } : {}), id: active.conversation.id })}`}
            className="ctx-scrim"
            aria-label="Скрыть сделку"
          />
        )}
        {active && (
          <aside className={`ctx ${showDeal ? 'ctx-open' : ''}`}>
            {deal ? (
              <DealPanel key={deal.id} deal={deal} stages={stages} members={members} lostReasons={lostReasonsOf(ctx.company)} />
            ) : (
              <StartDeal conversationId={active.conversation.id} />
            )}
          </aside>
        )}
      </div>
    </Shell>
  );
}
