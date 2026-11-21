/**
 * Заявка, которую бот собрал в переписке: имя, модель, размер, город,
 * получение, оплата. Менеджер видит, что клиент уже сказал, и не
 * переспрашивает. Пока не всё — бот продолжает спрашивать сам.
 */
export function LeadCard({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="deal-sec" style={{ marginTop: 16 }}>
      <div className="deal-sec-t">Заявка от бота</div>
      <div className="deal-order">
        {lines.map((l) => {
          const at = l.indexOf(': ');
          return (
            <div key={l} className="small" style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
              <span className="muted" style={{ minWidth: 86 }}>{l.slice(0, at)}</span>
              <b style={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{l.slice(at + 2)}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}
