'use client';

import { useTransition } from 'react';
import { startDealAction } from '@/app/deals/actions';

export function StartDeal({ conversationId }: { conversationId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="deal">
      <div className="deal-sec-t">Сделка</div>
      <p className="small muted" style={{ margin: '6px 0 12px' }}>
        Клиент писал до появления CRM — сделки по нему ещё нет.
      </p>
      <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => { await startDealAction(conversationId); })}>
        Завести сделку
      </button>
    </div>
  );
}
