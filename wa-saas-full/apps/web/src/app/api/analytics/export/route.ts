import * as XLSX from 'xlsx';
import { resolvePeriod } from '@wa/core';
import { requireCompany } from '@/lib/session';
import { loadDayTable } from '@/lib/day-analytics';

export const dynamic = 'force-dynamic';

/** Таблица «по дням» в Excel — те же цифры, что на странице «Аналитика». */
export async function GET(request: Request) {
  const ctx = await requireCompany('analytics:read');
  const url = new URL(request.url);
  const period = resolvePeriod(
    { d: url.searchParams.get('d') ?? undefined, from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined },
    ctx.company.timezone || 'Asia/Almaty',
  );
  const day = await loadDayTable(ctx, period);

  const head = ['День', 'Лиды', 'Из рекламы', 'Ответ ≤15 мин', 'Без ответа', 'Заказы', 'Сумма, ₸', 'Конверсия, %', 'Средний чек, ₸', 'Выкуплено', 'Отмена / возврат', 'Отказы'];
  const line = (label: string, r: (typeof day.rows)[number]) => [
    label, r.leads, r.fromAds, r.answeredFast, r.unanswered, r.orders, r.revenue, r.conversion ?? '', r.averageCheck ?? '', r.completed, r.cancelled, r.lost,
  ];
  const fmt = (k: string) => k.split('-').reverse().join('.');
  const rows = [head, ...[...day.rows].reverse().map((r) => line(fmt(r.key), r)), line('Итого', day.total)];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = head.map((h, i) => ({ wch: i === 0 ? 12 : Math.max(10, h.length + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'По дням');
  const file = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const name = `analitika_${period.fromKey}_${period.toKey}.xlsx`;
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
