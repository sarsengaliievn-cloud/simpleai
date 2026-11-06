'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closeConversationAction, reopenConversationAction } from '@/app/conversations/actions';
import { LostForm, OrderForm } from '@/components/crm/StageForms';

const CLOSED: Record<string, string> = { info: 'просто вопрос', won: 'купил', lost: 'отказ', spam: 'спам', done: 'сделка закрыта' };

/**
 * «Закрыть» в шапке переписки: итог в один клик. Купил — можно указать
 * сумму, отказ — причину. Закрытый диалог — пометка и «Открыть снова».
 */
export function CloseChat({ conversationId, closedReason, lostReasons }: { conversationId: string; closedReason: string | null | undefined; lostReasons: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<'won' | 'lost' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) { setError(r.error ?? 'Ошибка'); return; }
      setOpen(false);
      setForm(null);
      router.refresh();
    });

  if (closedReason) {
    return (
      <div className="row" style={{ gap: 6 }}>
        <span className="chip" title="Диалог закрыт">Закрыт · {CLOSED[closedReason] ?? closedReason}</span>
        <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => reopenConversationAction(conversationId))}>
          Открыть снова
        </button>
      </div>
    );
  }

  return (
    <div className="close-chat" ref={menu}>
      <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { setOpen(!open); setForm(null); setError(null); }} aria-expanded={open}>
        Закрыть ▾
      </button>
      {open && (
        <div className="close-menu" role="menu">
          {error && <div className="notice notice-bad" style={{ margin: 0 }}>{error}</div>}
          {form === 'won' ? (
            <OrderForm optional submitLabel="Закрыть: купил" pending={pending} onCancel={() => setForm(null)}
              onSubmit={(v) => run(() => closeConversationAction(conversationId, 'won', { amount: v.amount, product: v.product }))} />
          ) : form === 'lost' ? (
            <LostForm reasons={lostReasons} pending={pending} onCancel={() => setForm(null)}
              onSubmit={(reason) => run(() => closeConversationAction(conversationId, 'lost', { lostReason: reason }))} />
          ) : (
            <>
              <div className="tiny muted" style={{ padding: '2px 4px 6px' }}>Итог разговора</div>
              <button role="menuitem" disabled={pending} onClick={() => run(() => closeConversationAction(conversationId, 'info'))}>
                <b>Просто вопрос</b><span>график, адрес, доставка — не в отказы</span>
              </button>
              <button role="menuitem" disabled={pending} onClick={() => setForm('won')}>
                <b>Купил ✓</b><span>сделка — в «Купил»</span>
              </button>
              <button role="menuitem" disabled={pending} onClick={() => setForm('lost')}>
                <b>Отказ ✕</b><span>с причиной</span>
              </button>
              <button role="menuitem" disabled={pending} onClick={() => run(() => closeConversationAction(conversationId, 'spam'))}>
                <b>Спам</b><span>или ошибся номером — нигде не считается</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
