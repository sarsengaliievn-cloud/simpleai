import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma, forCompany } from '@wa/db';
import { applyShopOrder, parseShopOrder, type ApplyResult } from '@wa/core';

export const dynamic = 'force-dynamic';

/**
 * Интернет-заказы из склада SHOQAI.
 *
 *   POST /api/webhooks/sklad
 *   Authorization: Bearer <ключ из «Настроек → Склад»>
 *   { "orders": [ { id, number, phone, clientName, status, items:[{name,size,qty,sum}],
 *                   total, source, sellerName, city, carrier, track, trackUrl, createdAt, shippedAt } ] }
 *
 * Ключ определяет компанию: в базе лежит только его SHA-256. Без ключа —
 * 401, сессии и куки здесь не нужны (склад стучится с сервера).
 * GET с тем же ключом — проверка связи из склада.
 */
const MAX_ORDERS = 200;

async function companyByKey(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (key.length < 20 || key.length > 200) return null;
  const hash = createHash('sha256').update(key).digest('hex');
  const company = await prisma.company.findFirst({ where: { orderHookHash: hash }, select: { id: true, name: true, orderHookHash: true } });
  // Сравнение без утечки по времени — на случай, если индекс вернёт что-то похожее.
  if (!company?.orderHookHash || !timingSafeEqual(Buffer.from(company.orderHookHash), Buffer.from(hash))) return null;
  return company;
}

export async function GET(request: Request) {
  const company = await companyByKey(request);
  if (!company) return Response.json({ ok: false, error: 'Неверный ключ' }, { status: 401 });
  const db = forCompany(prisma, company.id);
  const [orders, linked] = await Promise.all([db.shopOrder.count(), db.shopOrder.count({ where: { customerId: { not: null } } })]);
  return Response.json({ ok: true, company: company.name, orders, linked });
}

export async function POST(request: Request) {
  const company = await companyByKey(request);
  if (!company) return Response.json({ ok: false, error: 'Неверный ключ' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Некорректный JSON' }, { status: 400 });
  }
  const raw = (body as { orders?: unknown; order?: unknown }) ?? {};
  const list = Array.isArray(raw.orders) ? raw.orders : raw.order ? [raw.order] : [];
  if (!list.length) return Response.json({ ok: false, error: 'Нет заказов' }, { status: 400 });
  if (list.length > MAX_ORDERS) return Response.json({ ok: false, error: `Не больше ${MAX_ORDERS} заказов за раз` }, { status: 413 });

  const db = forCompany(prisma, company.id);
  const results: ApplyResult[] = [];
  const errors: string[] = [];
  for (const item of list) {
    const parsed = parseShopOrder(item);
    if (typeof parsed === 'string') { errors.push(parsed); continue; }
    try {
      results.push(await applyShopOrder(db, parsed));
    } catch (e) {
      console.error('[sklad] заказ', parsed.id, e);
      errors.push(`заказ ${parsed.number ?? parsed.id}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  await prisma.company.update({ where: { id: company.id }, data: { orderHookAt: new Date() } });
  return Response.json({
    ok: errors.length === 0,
    saved: results.length,
    linked: results.filter((r) => r.linked).length,
    results,
    errors: errors.slice(0, 20),
  });
}
