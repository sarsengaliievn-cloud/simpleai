'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { moveDealAction } from '@/app/deals/actions';
import type { StageView } from '@/lib/crm';
import { money, since, initials, avatarColor, clockWithDay } from '@/lib/format';
import { OrderForm, LostForm } from './StageForms';

export type KanbanCard = {
  id: string;
  stageId: string;
  name: string;
  phone: string;
  amount: number | null;
  product: string | null;
  assignee: string | null;
  stageChangedAt: Date;
  unread: number;
  botActive: boolean;
  /** Без движения дольше порога — карточка краснеет. */
  stale?: boolean;
  lastActivity?: Date;
  remindAt?: Date | null;
  remindNote?: string | null;
  /** Сколько раз покупал раньше. */
  repeat?: number;
  /** Заголовок рекламы, если клиент пришёл с неё. */
  ad?: string | null;
};

type Pending = { card: KanbanCard; stage: StageView } | null;

/** Нужно ли спросить что-то перед переносом: сумму для заказа, причину для отказа. */
function needsForm(card: KanbanCard, stage: StageView) {
  if (stage.kind === 'LOST') return true;
  if (stage.kind === 'ORDER') return !card.amount || !card.product;
  // «Купил» без суммы — предложим указать, иначе продажа не попадёт в выручку.
  if (stage.kind === 'WON') return !card.amount;
  return false;
}

/**
 * Доска сделок. Карточку перетаскивают мышью; на «Новый заказ» и «Отказ»
 * сначала спрашиваем сумму или причину — без них этап не засчитывается.
 * На телефоне вместо перетаскивания — выбор этапа в карточке.
 */
export function Kanban({
  stages,
  cards: initial,
  linkParams,
  lostReasons,
}: {
  stages: StageView[];
  cards: KanbanCard[];
  linkParams: Record<string, string>;
  lostReasons: string[];
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [ask, setAsk] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Сервер прислал свежие данные (после действия или автообновления).
  useEffect(() => setCards(initial), [initial]);

  // Новые клиенты появляются сами — тихое обновление раз в 20 секунд.
  useEffect(() => {
    const t = setInterval(() => {
      if (!dragId && !ask) router.refresh();
    }, 20000);
    return () => clearInterval(t);
  }, [router, dragId, ask]);

  const href = (id: string) => `/deals?${new URLSearchParams({ ...linkParams, id })}`;

  const move = (card: KanbanCard, stage: StageView, extra?: Parameters<typeof moveDealAction>[2]) => {
    setError(null);
    const before = cards;
    setCards((list) => list.map((c) => (c.id === card.id ? { ...c, stageId: stage.id, stageChangedAt: new Date() } : c)));
    start(async () => {
      const result = await moveDealAction(card.id, stage.id, extra);
      if (!result.ok) {
        setCards(before);
        setError(result.error);
      } else {
        setAsk(null);
      }
    });
  };

  const request = (card: KanbanCard, stage: StageView) => {
    if (card.stageId === stage.id) return;
    if (needsForm(card, stage)) setAsk({ card, stage });
    else move(card, stage);
  };

  return (
    <>
      {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="kanban" role="list">
        {stages.map((stage) => {
          const list = cards.filter((c) => c.stageId === stage.id);
          const total = list.reduce((sum, c) => sum + (c.amount ?? 0), 0);
          return (
            <section
              key={stage.id}
              className={`kan-col k-${stage.kind.toLowerCase()} ${over === stage.id ? 'over' : ''}`}
              aria-label={`${stage.name}: ${list.length}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage.id);
              }}
              onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/plain') || dragId;
                const card = cards.find((c) => c.id === id);
                if (card) request(card, stage);
              }}
            >
              <header className="kan-h">
                <span className="kan-dot" />
                <span className="kan-name">{stage.name}</span>
                <span className="kan-count">{list.length}</span>
                {total > 0 && <span className="kan-sum">{money(total)}</span>}
              </header>

              <div className="kan-list">
                {list.map((card) => (
                  <article
                    key={card.id}
                    className={`kan-card ${dragId === card.id ? 'dragging' : ''} ${card.stale ? 'stale' : ''} ${card.remindAt && new Date(card.remindAt) <= new Date() ? 'due' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', card.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(card.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                  >
                    <Link href={href(card.id)} className="kan-link" draggable={false}>
                      <div className="spread" style={{ alignItems: 'flex-start' }}>
                        <span className="kan-card-n">{card.name}</span>
                        {card.unread > 0 && <span className="nav-badge">{card.unread}</span>}
                      </div>
                      {(card.repeat || card.ad || card.remindAt) ? (
                        <div className="kan-tags">
                          {card.repeat ? <span className="kan-tag tag-repeat" title="Уже покупал у вас">↻ покупал {card.repeat > 1 ? `${card.repeat} раза` : 'раньше'}</span> : null}
                          {card.ad ? <span className="kan-tag tag-ad" title={card.ad}>реклама</span> : null}
                          {card.remindAt ? (
                            <span className="kan-tag tag-remind" title={card.remindNote ?? 'Напоминание'} suppressHydrationWarning>⏰ {clockWithDay(card.remindAt)}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {(card.amount || card.product) && (
                        <div className="kan-card-o">
                          {card.amount ? <b>{money(card.amount)}</b> : null}
                          {card.product ? <span>{card.product}</span> : null}
                        </div>
                      )}
                      <div className="kan-card-f">
                        {card.assignee ? (
                          <span className="row" style={{ gap: 6 }}>
                            <span className="avatar avatar-xs" style={{ background: avatarColor(card.assignee) }}>{initials(card.assignee, '?')}</span>
                            {card.assignee.split(' ')[0]}
                          </span>
                        ) : (
                          <span>{card.botActive ? 'отвечает бот' : 'без менеджера'}</span>
                        )}
                        {card.stale ? (
                          <span className="kan-stale" suppressHydrationWarning title="Ни этап, ни переписка не менялись">завис · {since(card.lastActivity ?? card.stageChangedAt)}</span>
                        ) : (
                          <span suppressHydrationWarning>{since(card.stageChangedAt)}</span>
                        )}
                      </div>
                    </Link>
                    {/* Без мыши (телефон, клавиатура) — этап выбирается здесь. */}
                    <select
                      className="kan-move"
                      aria-label={`Этап для ${card.name}`}
                      value={card.stageId}
                      disabled={pending}
                      onChange={(e) => {
                        const stage = stages.find((s) => s.id === e.target.value);
                        if (stage) request(card, stage);
                      }}
                    >
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </article>
                ))}
                {list.length === 0 && <div className="kan-empty">Перетащите сюда</div>}
              </div>
            </section>
          );
        })}
      </div>

      {/* Пока тащим карточку — внизу зоны «Выдан» и «Отказ»: до крайних колонок
          на широкой доске иначе пришлось бы прокручивать. */}
      {dragId && (
        <div className="kan-dock" aria-hidden>
          {stages.filter((s) => s.kind === 'WON' || s.kind === 'LOST').map((stage) => (
            <div
              key={stage.id}
              className={`kan-dock-zone k-${stage.kind.toLowerCase()} ${over === `dock-${stage.id}` ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(`dock-${stage.id}`);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/plain') || dragId;
                const card = cards.find((c) => c.id === id);
                setDragId(null);
                if (card) request(card, stage);
              }}
            >
              <span className="kan-dot" />
              {stage.name}
            </div>
          ))}
        </div>
      )}

      {ask && (
        <div className="modal-scrim" onClick={() => !pending && setAsk(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={ask.stage.name} onClick={(e) => e.stopPropagation()}>
            <h2 className="card-t">{ask.stage.name} — {ask.card.name}</h2>
            {error && <div className="notice notice-bad">{error}</div>}
            {ask.stage.kind === 'LOST' ? (
              <LostForm reasons={lostReasons} pending={pending} onCancel={() => setAsk(null)} onSubmit={(reason) => move(ask.card, ask.stage, { lostReason: reason })} />
            ) : (
              <OrderForm
                initial={{ amount: ask.card.amount, product: ask.card.product }}
                pending={pending}
                optional={ask.stage.kind === 'WON'}
                submitLabel={ask.stage.kind === 'WON' ? `Перенести в «${ask.stage.name}»` : 'Оформить заказ'}
                onCancel={() => setAsk(null)}
                onSubmit={(v) => move(ask.card, ask.stage, v)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
