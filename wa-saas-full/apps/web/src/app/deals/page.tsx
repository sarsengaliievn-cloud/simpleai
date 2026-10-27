import Link from 'next/link';
import { can } from '@wa/core';
import { requireCompany } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { Kanban, type KanbanCard } from '@/components/crm/Kanban';
import { DealPanel } from '@/components/crm/DealPanel';
import { StageEditor } from '@/components/crm/StageEditor';
import { DealFilters } from '@/components/crm/DealFilters';
import { loadDeal, loadMembers, loadStages } from '@/lib/crm';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Закрытые сделки (выдан, отказ) на доске — только свежие, иначе колонки распухают. */
const CLOSED_DAYS = 30;

type Props = { searchParams: Promise<{ id?: string; m?: string; q?: string; stages?: string }> };

export default async function DealsPage({ searchParams }: Props) {
  const { id, m = '', q = '', stages: editStages } = await searchParams;
  const ctx = await requireCompany();
  const { db, ownDeals, seesOnlyOwn, role } = ctx;
  const canAssign = can(role, 'team:manage');
  const canEditStages = can(role, 'settings:manage');

  const query = q.trim().slice(0, 60);
  const digits = query.replace(/\D/g, '');
  const closedSince = new Date(Date.now() - CLOSED_DAYS * 24 * 60 * 60 * 1000);

  const [stages, members] = await Promise.all([loadStages(db), canAssign ? loadMembers(db) : Promise.resolve(null)]);

  const deals = await db.deal.findMany({
    where: {
      ...ownDeals,
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
      conversation: { select: { unreadCount: true, mode: true } },
    },
  });

  const cards: KanbanCard[] = deals.map((d) => ({
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
  }));

  const openValue = deals
    .filter((d) => stages.find((s) => s.id === d.stageId)?.kind === 'ORDER')
    .reduce((sum, d) => sum + (d.amount ?? 0), 0);

  const selected = id ? await loadDeal(db, { id, ...ownDeals }) : null;
  const params = (extra: Record<string, string>) => {
    const sp = new URLSearchParams({ ...(m ? { m } : {}), ...(query ? { q: query } : {}), ...extra });
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
      <div className="page deals-page">
        {editStages && canEditStages && <StageEditor key={stages.map((s) => s.id + s.name).join('|')} stages={stages} />}

        <DealFilters members={members} manager={m} query={query} />

        {cards.length === 0 && !query && !m ? (
          <div className="empty">
            <h3>{seesOnlyOwn ? 'Вам пока не передали клиентов' : 'Сделок пока нет'}</h3>
            <p>
              {seesOnlyOwn
                ? 'Когда владелец передаст вам клиента, карточка появится здесь.'
                : 'Карточка появляется сама, когда клиент впервые пишет в WhatsApp. Вручную заводить ничего не нужно.'}
            </p>
          </div>
        ) : (
          <Kanban stages={stages} cards={cards} linkParams={{ ...(m ? { m } : {}), ...(query ? { q: query } : {}) }} />
        )}
      </div>

      {selected && (
        <>
          <Link href={params({})} className="drawer-scrim" aria-label="Закрыть карточку" />
          <aside className="drawer" aria-label={`Сделка: ${selected.customer.name}`}>
            <div className="drawer-close">
              <Link href={params({})} className="btn btn-quiet btn-sm">Закрыть</Link>
            </div>
            <DealPanel key={selected.id} deal={selected} stages={stages} members={members} showDialogLink />
          </aside>
        </>
      )}
    </Shell>
  );
}
