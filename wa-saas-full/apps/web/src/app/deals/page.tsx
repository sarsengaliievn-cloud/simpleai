import Link from 'next/link';
import { can, isStale, lostReasonsOf, onShiftNow, type StageKind } from '@wa/core';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { Kanban, type KanbanCard } from '@/components/crm/Kanban';
import { DealPanel } from '@/components/crm/DealPanel';
import { StageEditor } from '@/components/crm/StageEditor';
import { DealFilters } from '@/components/crm/DealFilters';
import { loadDeal, loadMembers, loadStages, purchaseCounts } from '@/lib/crm';
import { loadThread } from '@/lib/thread';
import { approvedTemplates } from '@/lib/templates';
import { ThreadView } from '@/components/ThreadView';
import { AutoRefresh } from '@/components/AutoRefresh';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Закрытые сделки (выдан, отказ) на доске — только свежие, иначе колонки распухают. */
const CLOSED_DAYS = 30;

type Props = { searchParams: Promise<{ id?: string; m?: string; q?: string; f?: string; stages?: string; tab?: string }> };

export default async function DealsPage({ searchParams }: Props) {
  const { id, m = '', q = '', f: rawFilter = '', stages: editStages, tab } = await searchParams;
  const filter = rawFilter === 'stale' || rawFilter === 'remind' ? rawFilter : '';
  const ctx = await requireCompany();
  const { db, ownDeals, seesOnlyOwn, role, company } = ctx;
  const lostReasons = lostReasonsOf(company);
  const canAssign = can(role, 'team:manage');
  const canEditStages = can(role, 'settings:manage');

  const query = q.trim().slice(0, 60);
  const digits = query.replace(/\D/g, '');
  const closedSince = new Date(Date.now() - CLOSED_DAYS * 24 * 60 * 60 * 1000);

  const [stages, members] = await Promise.all([loadStages(db), canAssign ? loadMembers(db) : Promise.resolve(null)]);

  const deals = await db.deal.findMany({
    where: {
      ...ownDeals,
      // «Просто вопрос» и спам — не продажи, доску не засоряют.
      archivedAt: null,
      ...(m === 'none' ? { assigneeId: null } : m && !seesOnlyOwn ? { assigneeId: m } : {}),
      OR: [
        { stage: { kind: { notIn: ['WON', 'LOST'] } } },
        { stageChangedAt: { gte: closedSince } },
      ],
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
    },
    orderBy: { stageChangedAt: 'desc' },
    take: 500,
    include: {
      customer: true,
      assignee: true,
      conversation: { select: { unreadCount: true, mode: true, lastMessageAt: true } },
    },
  });

  const now = new Date();
  const kindOf = new Map(stages.map((s) => [s.id, s.kind as StageKind]));
  const bought = await purchaseCounts(db, deals.map((d) => d.customerId));

  const allCards: KanbanCard[] = deals.map((d) => ({
    id: d.id,
    stageId: d.stageId,
    name: d.customer.name ?? `+${d.customer.waId}`,
    phone: d.customer.phone,
    amount: d.amount,
    product: d.product,
    assignee: d.assignee ? `${d.assignee.firstName} ${d.assignee.lastName}`.trim() : null,
    stageChangedAt: d.stageChangedAt,
    unread: d.conversation?.unreadCount ?? 0,
    botActive: d.conversation?.mode === 'AI',
    stale: isStale(
      {
        stageKind: kindOf.get(d.stageId) ?? 'WORK',
        stageChangedAt: d.stageChangedAt,
        lastMessageAt: d.conversation?.lastMessageAt,
        remindAt: d.remindAt,
        botActive: d.conversation?.mode === 'AI',
      },
      company.staleHours,
      now,
    ),
    lastActivity: new Date(Math.max(d.stageChangedAt.getTime(), d.conversation?.lastMessageAt?.getTime() ?? 0)),
    remindAt: d.remindAt,
    remindNote: d.remindNote,
    // Покупки до этой сделки: сама сделка, если уже «Купил», не считается.
    repeat: (bought.get(d.customerId) ?? 0) - (d.wonAt ? 1 : 0),
    ad: d.source === 'ad' ? d.adHeadline || 'Реклама' : null,
  }));
  const staleCount = allCards.filter((c) => c.stale).length;
  const remindCount = allCards.filter((c) => c.remindAt).length;
  const cards =
    filter === 'stale' ? allCards.filter((c) => c.stale)
    : filter === 'remind' ? allCards.filter((c) => c.remindAt).sort((a, b) => a.remindAt!.getTime() - b.remindAt!.getTime())
    : allCards;

  // Для редактора этапов: сколько сделок на каждом (все, не только свежие закрытые).
  const counts = editStages && canEditStages
    ? Object.fromEntries((await db.deal.groupBy({ by: ['stageId'], _count: { _all: true } })).map((r) => [r.stageId, r._count._all]))
    : {};

  // Кто сейчас на смене — владельцу видно, кому уйдёт следующий клиент.
  const onShift = company.autoAssign && !seesOnlyOwn
    ? (await db.membership.findMany({ where: { onShift: true }, include: { user: true } }))
        .filter((x) => onShiftNow(x, now))
        .map((x) => x.user.firstName || x.user.email)
    : null;

  const openValue = deals
    .filter((d) => stages.find((s) => s.id === d.stageId)?.kind === 'ORDER')
    .reduce((sum, d) => sum + (d.amount ?? 0), 0);

  const selected = id && /^[0-9a-f-]{36}$/i.test(id) ? await loadDeal(db, { id, ...ownDeals }) : null;
  // Переписка прямо в карточке: сотрудники не уходят в «Диалоги» и не теряются.
  const thread = selected?.conversationId ? await loadThread(db, { id: selected.conversationId }) : null;
  const quickReplies = thread ? await db.quickReply.findMany({ orderBy: { position: 'asc' }, select: { id: true, title: true, text: true } }) : [];
  const templates = thread && !thread.conversation.windowOpen ? await approvedTemplates(db, thread.accountId) : [];
  const params = (extra: Record<string, string>) => {
    const sp = new URLSearchParams({ ...(m ? { m } : {}), ...(query ? { q: query } : {}), ...(filter ? { f: filter } : {}), ...extra });
    return `/deals${sp.size ? `?${sp}` : ''}`;
  };

  return (
    <Shell
      ctx={ctx}
      title="Сделки"
      hint={
        seesOnlyOwn
          ? 'Ваши клиенты по этапам. Перетащите карточку, когда клиент продвинулся'
          : 'Каждый клиент — карточка. Передайте менеджеру, отметьте заказ или отказ'
      }
      actions={
        <>
          {openValue > 0 && <span className="top-stat">Заказов на {money(openValue)}</span>}
          {canEditStages && (
            <Link href={editStages ? params({}) : params({ stages: '1' })} className="btn btn-ghost btn-sm">
              {editStages ? 'Готово' : 'Этапы'}
            </Link>
          )}
        </>
      }
    >
      <div className={`page deals-page ${editStages && canEditStages ? '' : 'deals-fit'}`}>
        {editStages && canEditStages && (
          <StageEditor
            key={stages.map((s) => s.id + s.name + s.kind).join('|')}
            stages={stages}
            counts={counts}
            lostReasons={lostReasons}
            customReasons={(company.lostReasons ?? []).length > 0}
          />
        )}

        <DealFilters members={members} manager={m} query={query} filter={filter} staleCount={staleCount} remindCount={remindCount} staleHours={company.staleHours} />
        {onShift && (
          <p className="tiny muted" style={{ margin: '-4px 0 10px' }}>
            {onShift.length ? `На смене: ${onShift.join(', ')} — новые клиенты уходят им по очереди` : 'На смене никого — новые клиенты ждут без менеджера'}
          </p>
        )}

        {allCards.length === 0 && !query && !m ? (
          <div className="empty">
            <h3>{seesOnlyOwn ? 'Вам пока не передали клиентов' : 'Сделок пока нет'}</h3>
            <p>
              {seesOnlyOwn
                ? 'Когда владелец передаст вам клиента, карточка появится здесь.'
                : 'Карточка появляется сама, когда клиент впервые пишет в WhatsApp. Вручную заводить ничего не нужно.'}
            </p>
          </div>
        ) : (
          <Kanban stages={stages} cards={cards} lostReasons={lostReasons} linkParams={{ ...(m ? { m } : {}), ...(query ? { q: query } : {}), ...(filter ? { f: filter } : {}) }} />
        )}
      </div>

      {selected && (
        <>
          <Link href={params({})} className="drawer-scrim" aria-label="Закрыть карточку" />
          <aside className={`drawer ${thread ? 'drawer-wide' : ''} ${tab === 'deal' ? 'tab-deal' : 'tab-chat'}`} aria-label={`Сделка: ${selected.customer.name}`}>
            <div className="drawer-close">
              {thread && (
                <div className="seg drawer-tabs" role="tablist">
                  <Link href={params({ id: selected.id })} className={tab === 'deal' ? '' : 'on'} role="tab">Переписка</Link>
                  <Link href={params({ id: selected.id, tab: 'deal' })} className={tab === 'deal' ? 'on' : ''} role="tab">Сделка</Link>
                </div>
              )}
              <span style={{ flex: 1 }} />
              <Link href={params({})} className="btn btn-quiet btn-sm">Закрыть</Link>
            </div>
            <div className="drawer-body">
              {thread && (
                <div className="drawer-chat">
                  <ThreadView
                    key={thread.conversation.id}
                    conversation={thread.conversation}
                    messages={thread.messages}
                    quickReplies={quickReplies}
                    lostReasons={lostReasons}
                    templates={templates}
                    backHref={params({})}
                  />
                  <AutoRefresh active intervalMs={8000} />
                </div>
              )}
              <div className="drawer-deal">
                <DealPanel key={selected.id} deal={selected} stages={stages} members={members} lostReasons={lostReasons} />
              </div>
            </div>
          </aside>
        </>
      )}
    </Shell>
  );
}
