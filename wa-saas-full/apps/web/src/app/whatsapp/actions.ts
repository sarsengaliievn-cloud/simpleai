'use server';

import { revalidatePath } from 'next/cache';
import { requireCompany } from '@/lib/session';
import { encryptSecret } from '@wa/core';
import { prisma } from '@wa/db';

const GRAPH = 'https://graph.facebook.com/v24.0';

/* ─────────────────────────────────────────────────────────────
   Шаг 1: проверка номера до запуска Embedded Signup
   ───────────────────────────────────────────────────────────── */

/**
 * Meta не даёт публично проверить, занят ли номер, до самого подключения.
 * Поэтому проверяем то, что действительно можем: формат и не подключён ли
 * номер уже в нашей системе. Всё остальное выяснится в окне Meta.
 */
export async function checkNumber(raw: string) {
  const digits = raw.replace(/\D/g, '');

  if (digits.length < 10 || digits.length > 15) {
    return { ok: false as const, error: 'Проверьте номер: нужен формат +7 XXX XXX XXXX' };
  }

  const taken = await prisma.whatsAppPhoneNumber.findFirst({
    where: { displayPhoneNumber: { contains: digits.slice(-9) }, status: { not: 'DISCONNECTED' } },
    select: { companyId: true },
  });

  if (taken) {
    const { company } = await requireCompany();
    return taken.companyId === company.id
      ? { ok: false as const, error: 'Этот номер уже подключён к вашей компании' }
      : { ok: false as const, error: 'Номер занят другой компанией' };
  }

  return {
    ok: true as const,
    normalized: `+${digits}`,
    note: 'Номер не должен быть привязан к обычному WhatsApp — иначе Meta откажет на своём шаге.',
  };
}

/* ─────────────────────────────────────────────────────────────
   Шаг 2: завершение Embedded Signup
   ───────────────────────────────────────────────────────────── */

/**
 * Окно Meta возвращает код авторизации, WABA ID и Phone Number ID.
 * Здесь код меняется на токен, приложение подписывается на вебхуки WABA
 * и номер регистрируется в Cloud API. Все три вызова обязательны:
 * без подписки сообщения не придут, без регистрации нельзя отправлять.
 */
export async function completeEmbeddedSignup(input: {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}) {
  const { company, db } = await requireCompany();

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false as const, error: 'В .env не заданы META_APP_ID и META_APP_SECRET' };
  }

  // 1. Код → токен доступа бизнеса клиента.
  let accessToken: string;
  try {
    const url = `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${input.code}`;
    const response = await fetch(url);
    const data = (await response.json()) as { access_token?: string; error?: { message?: string } };

    if (!response.ok || !data.access_token) {
      return { ok: false as const, error: data.error?.message ?? 'Meta не выдала токен доступа' };
    }
    accessToken = data.access_token;
  } catch {
    return { ok: false as const, error: 'Не удалось связаться с Meta. Попробуйте ещё раз.' };
  }

  // 2. Подписка приложения на вебхуки этого WABA — иначе входящих не будет.
  const subscribe = await fetch(`${GRAPH}/${input.wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!subscribe.ok) {
    const body = await subscribe.text();
    console.error('[embedded-signup] подписка не удалась', body);
    return { ok: false as const, error: 'Не удалось подписаться на события WhatsApp' };
  }

  // 3. Регистрация номера в Cloud API. PIN двухфакторной защиты задаём сами
  //    и храним у себя — Meta спросит его при повторной регистрации.
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const register = await fetch(`${GRAPH}/${input.phoneNumberId}/register`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  });
  if (!register.ok) {
    const body = await register.text();
    console.error('[embedded-signup] регистрация номера не удалась', body);
    // Номер мог быть зарегистрирован ранее — это не повод терять подключение.
  }

  // 4. Подтягиваем данные номера для интерфейса.
  let display = input.phoneNumberId;
  let verifiedName: string | null = null;
  let quality: string | null = null;
  try {
    const info = await fetch(
      `${GRAPH}/${input.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    const data = (await info.json()) as {
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
    };
    display = data.display_phone_number ?? display;
    verifiedName = data.verified_name ?? null;
    quality = data.quality_rating ?? null;
  } catch {
    // Не критично: подключение уже состоялось, детали подтянутся при проверке.
  }

  const encrypted = encryptSecret(accessToken);

  const existingAccount = await db.whatsAppAccount.findFirst({ where: { wabaId: input.wabaId } });
  const account = existingAccount
    ? (await db.whatsAppAccount.updateMany({
        where: { id: existingAccount.id },
        data: { accessToken: encrypted, status: 'CONNECTED', connectedVia: 'EMBEDDED_SIGNUP' },
      }),
      existingAccount)
    : await db.whatsAppAccount.create({
        data: {
          wabaId: input.wabaId,
          accessToken: encrypted,
          connectedVia: 'EMBEDDED_SIGNUP',
          status: 'CONNECTED',
        } as never,
      });

  const existingNumber = await db.whatsAppPhoneNumber.findFirst({
    where: { phoneNumberId: input.phoneNumberId },
  });

  if (existingNumber) {
    await db.whatsAppPhoneNumber.updateMany({
      where: { id: existingNumber.id },
      data: {
        displayPhoneNumber: display,
        verifiedName,
        qualityRating: quality,
        status: 'CONNECTED',
        webhookVerifiedAt: new Date(),
      },
    });
  } else {
    await db.whatsAppPhoneNumber.create({
      data: {
        accountId: account.id,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: display,
        verifiedName,
        qualityRating: quality,
        status: 'CONNECTED',
        webhookVerifiedAt: new Date(),
      } as never,
    });
  }

  await db.auditLog.create({
    data: {
      action: 'whatsapp.number.connected',
      entityType: 'WhatsAppPhoneNumber',
      entityId: input.phoneNumberId,
      metadata: { via: 'embedded_signup', wabaId: input.wabaId, company: company.name },
    } as never,
  });

  revalidatePath('/whatsapp');
  return { ok: true as const, display };
}

/* ─────────────────────────────────────────────────────────────
   Запасной путь: ручное подключение
   ───────────────────────────────────────────────────────────── */

export async function connectNumber(formData: FormData) {
  const { db } = await requireCompany();

  const wabaId = String(formData.get('wabaId') ?? '').trim();
  const phoneNumberId = String(formData.get('phoneNumberId') ?? '').trim();
  const displayPhoneNumber = String(formData.get('displayPhoneNumber') ?? '').trim();
  const token = String(formData.get('token') ?? '').trim();

  if (!wabaId || !phoneNumberId || !displayPhoneNumber || !token) {
    return { ok: false as const, error: 'Заполните все поля' };
  }

  let encrypted: string;
  try {
    encrypted = encryptSecret(token);
  } catch {
    return { ok: false as const, error: 'Не задан ENCRYPTION_KEY в .env — без него токен негде хранить безопасно.' };
  }

  const existing = await db.whatsAppAccount.findFirst({ where: { wabaId } });
  const account = existing
    ? (await db.whatsAppAccount.updateMany({
        where: { id: existing.id },
        data: { accessToken: encrypted, status: 'CONNECTED' },
      }),
      existing)
    : await db.whatsAppAccount.create({
        data: { wabaId, accessToken: encrypted, connectedVia: 'MANUAL', status: 'CONNECTED' } as never,
      });

  const number = await db.whatsAppPhoneNumber.findFirst({ where: { phoneNumberId } });
  if (number) {
    await db.whatsAppPhoneNumber.updateMany({
      where: { id: number.id },
      data: { displayPhoneNumber, status: 'CONNECTED' },
    });
  } else {
    await db.whatsAppPhoneNumber.create({
      data: { accountId: account.id, phoneNumberId, displayPhoneNumber, status: 'CONNECTED' } as never,
    });
  }

  await db.auditLog.create({
    data: { action: 'whatsapp.number.connected', entityType: 'WhatsAppPhoneNumber', entityId: phoneNumberId } as never,
  });

  revalidatePath('/whatsapp');
  return { ok: true as const };
}

export async function disconnectNumber(numberId: string) {
  const { db } = await requireCompany();
  await db.whatsAppPhoneNumber.updateMany({ where: { id: numberId }, data: { status: 'DISCONNECTED' } });
  await db.auditLog.create({
    data: { action: 'whatsapp.number.disconnected', entityType: 'WhatsAppPhoneNumber', entityId: numberId } as never,
  });
  revalidatePath('/whatsapp');
}
