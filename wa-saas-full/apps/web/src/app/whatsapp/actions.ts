'use server';

import { revalidatePath } from 'next/cache';
import { requireCompany } from '@/lib/session';
import { encryptSecret } from '@wa/core';
import { prisma } from '@wa/db';
import { getProvider, graphBase, WhatsAppSendError, type PhoneNumberInfo } from '@wa/whatsapp';

const GRAPH = graphBase();

/* ─────────────────────────────────────────────────────────────
   Шаг 1: проверка номера до запуска Embedded Signup
   ───────────────────────────────────────────────────────────── */

/**
 * Meta не даёт публично проверить, занят ли номер, до самого подключения.
 * Поэтому проверяем то, что действительно можем: формат и не подключён ли
 * номер уже в нашей системе. Всё остальное выяснится в окне Meta.
 */
export async function checkNumber(raw: string) {
  // Проверка нужна только своим: без входа она превращалась в способ
  // узнать, какие номера подключены к платформе.
  const { company } = await requireCompany();
  const digits = raw.replace(/\D/g, '');

  if (digits.length < 10 || digits.length > 15) {
    return { ok: false as const, error: 'Проверьте номер: нужен формат +7 XXX XXX XXXX' };
  }

  // В базе номер хранится для показа — «+7 707 512 44 90», с пробелами.
  // Поиск подстрокой по цифрам его не находил, поэтому сравниваем
  // нормализованные цифры.
  const active = await prisma.whatsAppPhoneNumber.findMany({
    where: { status: { not: 'DISCONNECTED' } },
    select: { companyId: true, displayPhoneNumber: true },
  });
  const tail = digits.slice(-10);
  const taken = active.find((n) => n.displayPhoneNumber.replace(/\D/g, '').endsWith(tail));

  if (taken) {
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

/**
 * Phone Number ID уникален на всю платформу. Если он уже у другой
 * компании, create падал с необработанной ошибкой уникальности —
 * пользователь видел белый экран вместо объяснения.
 */
async function numberOwnedByOther(phoneNumberId: string, companyId: string) {
  const row = await prisma.whatsAppPhoneNumber.findUnique({
    where: { phoneNumberId },
    select: { companyId: true },
  });
  return Boolean(row && row.companyId !== companyId);
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
  const { company, db, user } = await requireCompany();

  if (!/^\d{5,25}$/.test(input.wabaId) || !/^\d{5,25}$/.test(input.phoneNumberId) || !input.code) {
    return { ok: false as const, error: 'Meta вернула неполные данные подключения' };
  }
  if (await numberOwnedByOther(input.phoneNumberId, company.id)) {
    return { ok: false as const, error: 'Этот номер уже подключён к другой компании на платформе' };
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false as const, error: 'В .env не заданы META_APP_ID и META_APP_SECRET' };
  }

  // 1. Код → токен доступа бизнеса клиента.
  let accessToken: string;
  try {
    const query = new URLSearchParams({ client_id: appId, client_secret: appSecret, code: input.code });
    const url = `${GRAPH}/oauth/access_token?${query}`;
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
      actorUserId: user.id,
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
  const { company, db, user } = await requireCompany();

  const wabaId = String(formData.get('wabaId') ?? '').trim();
  const phoneNumberId = String(formData.get('phoneNumberId') ?? '').trim();
  let displayPhoneNumber = String(formData.get('displayPhoneNumber') ?? '').trim();
  const token = String(formData.get('token') ?? '').trim();
  const pin = String(formData.get('pin') ?? '').trim();

  const live = getProvider().name === 'cloud';

  if (!wabaId || !phoneNumberId || !token || (!live && !displayPhoneNumber)) {
    return { ok: false as const, error: 'Заполните все поля' };
  }
  if (!/^\d{5,25}$/.test(wabaId) || !/^\d{5,25}$/.test(phoneNumberId)) {
    return { ok: false as const, error: 'WABA ID и Phone Number ID состоят только из цифр — скопируйте их из WhatsApp Manager' };
  }
  if (pin && !/^\d{6}$/.test(pin)) {
    return { ok: false as const, error: 'PIN — это 6 цифр двухэтапной проверки номера' };
  }
  if (await numberOwnedByOther(phoneNumberId, company.id)) {
    return { ok: false as const, error: 'Этот Phone Number ID уже подключён к другой компании на платформе' };
  }

  // Боевой режим: прежде чем сохранять, спрашиваем Meta. Иначе опечатка
  // в токене всплыла бы только на первом клиенте, которому бот не ответил.
  let info: PhoneNumberInfo | null = null;
  if (live) {
    const provider = getProvider();
    try {
      info = await provider.getPhoneNumber({ phoneNumberId, accessToken: token });
    } catch (error) {
      const text = error instanceof WhatsAppSendError ? error.userMessage : 'Meta не ответила — попробуйте ещё раз.';
      return { ok: false as const, error: `Проверка номера в Meta не прошла: ${text}` };
    }

    if (pin) {
      try {
        await provider.registerNumber({ phoneNumberId, pin, accessToken: token });
      } catch (error) {
        // Номер уже зарегистрирован — это не ошибка подключения.
        const msg = (error as Error).message.toLowerCase();
        if (!msg.includes('already') && !msg.includes('уже')) {
          const text = error instanceof WhatsAppSendError ? error.userMessage : 'регистрация не удалась';
          return { ok: false as const, error: `Регистрация номера в Cloud API не прошла: ${text}` };
        }
      }
    }

    try {
      // Без подписки Meta не пришлёт ни одного входящего сообщения.
      await provider.subscribeApp({ wabaId, accessToken: token });
    } catch (error) {
      const text = error instanceof WhatsAppSendError ? error.userMessage : 'подписка не удалась';
      return { ok: false as const, error: `Не удалось подписать WhatsApp-аккаунт на входящие: ${text} Проверьте, что WABA ID верный.` };
    }

    displayPhoneNumber = info.displayPhoneNumber || displayPhoneNumber;
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
        data: { accessToken: encrypted, status: 'CONNECTED', lastCheckedAt: new Date() },
      }),
      existing)
    : await db.whatsAppAccount.create({
        data: { wabaId, accessToken: encrypted, connectedVia: 'MANUAL', status: 'CONNECTED', lastCheckedAt: new Date() } as never,
      });

  const details = {
    displayPhoneNumber,
    verifiedName: info?.verifiedName ?? undefined,
    qualityRating: info?.qualityRating ?? undefined,
    messagingLimit: info?.messagingLimit ?? undefined,
    status: 'CONNECTED' as const,
    ...(live ? { webhookVerifiedAt: new Date() } : {}),
  };

  const number = await db.whatsAppPhoneNumber.findFirst({ where: { phoneNumberId } });
  if (number) {
    // Номер могли перенести в другой WABA — привязываем к актуальному.
    await db.whatsAppPhoneNumber.updateMany({ where: { id: number.id }, data: { ...details, accountId: account.id } });
  } else {
    await db.whatsAppPhoneNumber.create({
      data: { accountId: account.id, phoneNumberId, ...details } as never,
    });
  }

  await db.auditLog.create({
    data: { action: 'whatsapp.number.connected', actorUserId: user.id, entityType: 'WhatsAppPhoneNumber', entityId: phoneNumberId, metadata: { via: 'manual', live } } as never,
  });

  revalidatePath('/whatsapp');
  return { ok: true as const, display: displayPhoneNumber, verifiedName: info?.verifiedName ?? null };
}

export async function disconnectNumber(numberId: string) {
  const { db, user } = await requireCompany();
  const { count } = await db.whatsAppPhoneNumber.updateMany({
    where: { id: numberId, status: { not: 'DISCONNECTED' } },
    data: { status: 'DISCONNECTED' },
  });
  if (count === 0) return;
  await db.auditLog.create({
    data: { action: 'whatsapp.number.disconnected', actorUserId: user.id, entityType: 'WhatsAppPhoneNumber', entityId: numberId } as never,
  });
  revalidatePath('/whatsapp');
}
