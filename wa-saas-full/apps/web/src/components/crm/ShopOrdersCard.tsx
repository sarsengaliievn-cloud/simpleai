import { SHOP_STATUS_NAME, type ShopStatus } from '@wa/core';
import { money } from '@/lib/format';

export type ShopOrderView = {
  id: string; number: string | null; status: string; total: number; items: unknown;
  carrier: string | null; track: string | null; trackUrl: string | null; sellerName: string | null; orderedAt: Date;
};

const DONE = new Set(['completed']);
const BAD = new Set(['cancelled', 'returned']);

/**
 * Заказы клиента из склада — справа под сделкой. Только чтение: заказ
 * ведут в складе, сюда он приходит сам.
 */
export function ShopOrdersCard({ orders }: { orders: ShopOrderView[] }) {
  if (!orders.length) return null;
  return (
    <div className="deal-sec" style={{ marginTop: 16 }}>
      <div className="deal-sec-t">Заказы в складе</div>
      <div style={{ display: 'grid', gap: 10 }}>
        {orders.map((o) => {
          const items = Array.isArray(o.items) ? (o.items as { name: string; size: string; qty: number }[]) : [];
          const status = SHOP_STATUS_NAME[o.status as ShopStatus] ?? o.status;
          return (
            <div key={o.id} className="deal-order" style={BAD.has(o.status) ? { background: 'var(--red-soft)', borderColor: 'transparent' } : undefined}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <b className="small">{o.number ? `№${o.number}` : 'Заказ'} · {o.orderedAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Almaty' })}</b>
                <span className="deal-amount" style={{ fontSize: 15 }}>{money(o.total)}</span>
              </div>
              <div className="tiny" style={{ marginTop: 4, color: DONE.has(o.status) ? 'var(--pine-600)' : BAD.has(o.status) ? 'var(--red)' : undefined, fontWeight: 600 }}>
                {status}{o.sellerName ? ` · ${o.sellerName}` : ''}
              </div>
              <ul className="tiny" style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                {items.slice(0, 6).map((i, k) => <li key={k}>{i.name}{i.size ? `, р. ${i.size}` : ''}{i.qty > 1 ? ` ×${i.qty}` : ''}</li>)}
              </ul>
              {o.track && (
                <div className="tiny" style={{ marginTop: 6 }}>
                  {o.carrier ? `${o.carrier}: ` : 'Трек: '}
                  {o.trackUrl ? <a href={o.trackUrl} target="_blank" rel="noreferrer">{o.track}</a> : o.track}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
