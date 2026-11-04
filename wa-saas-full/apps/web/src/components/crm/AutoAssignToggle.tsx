'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAutoAssignAction } from '@/app/shift/actions';

/** Авто-распределение клиентов по менеджерам на смене. */
export function AutoAssignToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="switch-row">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          start(async () => {
            await setAutoAssignAction(next);
            router.refresh();
          });
        }}
      />
      <span>
        <b>Раздавать новых клиентов по очереди</b>
        <span className="tiny muted" style={{ display: 'block' }}>
          Когда бот передаёт клиента людям (или бот выключен), клиент сам уходит следующему менеджеру на смене.
        </span>
      </span>
    </label>
  );
}
