'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startShiftAction, endShiftAction, pingShiftAction } from '@/app/shift/actions';

const PING_MS = 2 * 60 * 1000;
const MAX_MS = 14 * 60 * 60 * 1000;

/**
 * «Начать смену»: пока смена идёт и панель открыта, бот передаёт новых
 * клиентов этому менеджеру по очереди с остальными. Закрыл вкладку —
 * через 15 минут очередь его пропускает; через 14 часов смена кончается сама.
 */
export function ShiftToggle({ onShift, startedAt }: { onShift: boolean; startedAt: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const active = onShift && !!startedAt && Date.now() - new Date(startedAt).getTime() < MAX_MS;

  useEffect(() => {
    if (!active) return;
    const ping = () => {
      pingShiftAction().catch(() => {});
    };
    const t = setInterval(ping, PING_MS);
    return () => clearInterval(t);
  }, [active]);

  const since = active && startedAt
    ? new Date(startedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`shift ${active ? 'on' : ''}`}>
      <div className="shift-t">
        <span className="shift-dot" aria-hidden />
        <span>{active ? `На смене с ${since}` : 'Не на смене'}</span>
      </div>
      <button
        type="button"
        className={`btn btn-sm ${active ? 'btn-quiet' : 'btn-primary'}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setNote(null);
            if (active) await endShiftAction();
            else {
              const r = await startShiftAction();
              if (r.picked) setNote(`Вам передано ждущих клиентов: ${r.picked}`);
            }
            router.refresh();
          })
        }
      >
        {pending ? '…' : active ? 'Закончить' : 'Начать смену'}
      </button>
      {note && <div className="tiny" style={{ width: '100%' }}>{note}</div>}
      {!active && <div className="tiny muted" style={{ width: '100%' }}>Новых клиентов получают только те, кто на смене</div>}
    </div>
  );
}
