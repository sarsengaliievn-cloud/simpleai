import type { TenantClient } from '@wa/db';
import { graphBase } from '@wa/whatsapp';
import { decryptSecret } from './crypto.js';

/**
 * Шаблоны сообщений WhatsApp. Если клиент молчит больше 24 часов, Meta
 * пропускает только заранее одобренный текст. Владелец пишет его по-людски —
 * «Здравствуйте, {имя}! Трек-номер: {трек}» — мы превращаем это в формат
 * Meta ({{1}}, {{2}}), отправляем на проверку и потом подтягиваем статус.
 */

export class TemplateError extends Error {}

export type TemplateCategory = 'MARKETING' | 'UTILITY';

/** Поле, которое подставляется само: имя клиента. */
export const NAME_VARIABLE = 'имя';

const MAX_BODY = 1024;
const MAX_VARS = 6;

/** «Здравствуйте, {имя}! Трек: {трек}.» → body с {{1}}, {{2}} и список полей. */
export function parseTemplateText(raw: string) {
  const text = String(raw ?? '').replace(/\r/g, '').trim();
  if (!text) throw new TemplateError('Напишите текст шаблона');
  if (text.length > MAX_BODY) throw new TemplateError(`Текст длиннее ${MAX_BODY} символов`);
  if (/\{\{\s*\d+\s*\}\}/.test(text)) throw new TemplateError('Поля пишите словами в фигурных скобках: {имя}, {трек}');

  const variables: string[] = [];
  const body = text.replace(/\{\s*([^{}]{1,30}?)\s*\}/g, (_m, label: string) => {
    const key = label.trim().toLowerCase();
    let index = variables.indexOf(key);
    if (index === -1) {
      variables.push(key);
      index = variables.length - 1;
    }
    return `{{${index + 1}}}`;
  });
  if (variables.length > MAX_VARS) throw new TemplateError(`Не больше ${MAX_VARS} полей в одном шаблоне`);
  if (/[{}]/.test(body.replace(/\{\{\d+\}\}/g, ''))) throw new TemplateError('Лишняя фигурная скобка — поля пишутся так: {имя}');
  // Правило Meta: поле не может стоять в самом начале или в самом конце текста.
  if (/^\{\{\d+\}\}/.test(body)) throw new TemplateError('Шаблон не может начинаться с поля — добавьте слово перед ним, например «Здравствуйте, {имя}!»');
  if (/\{\{\d+\}\}[\s.!?]*$/.test(body)) throw new TemplateError('Шаблон не может заканчиваться полем — допишите фразу после него');
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) throw new TemplateError('Два поля подряд Meta не принимает — разделите их словами');
  return { body, variables };
}

/** Имя шаблона в Meta: латиница, цифры, подчёркивание и короткий хвост для уникальности. */
export function templateName(title: string, suffix = Math.random().toString(36).slice(2, 6)) {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
    ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
  };
  const base = title.toLowerCase().split('').map((c) => map[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'shablon';
  return `${base}_${suffix}`;
}

/** Пример значения поля — Meta без примеров шаблон не принимает. */
function exampleFor(label: string) {
  if (label === NAME_VARIABLE) return 'Айгерим';
  if (/трек|track/.test(label)) return 'RB123456789KZ';
  if (/сумм|цен/.test(label)) return '33 900 ₸';
  if (/дат|срок/.test(label)) return '12 ноября';
  if (/модел|товар/.test(label)) return 'Зимние ботинки';
  return 'пример';
}

/** Текст, который увидит клиент: поля заменены значениями. */
export function renderTemplate(body: string, values: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => values[Number(n) - 1] ?? '');
}

const META_STATUS = new Set(['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION']);
const live = () => (process.env.WHATSAPP_PROVIDER ?? 'mock').toLowerCase() === 'cloud';

async function graph<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${graphBase()}/${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new TemplateError('Не удалось связаться с WhatsApp — попробуйте ещё раз');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; error_user_title?: string; code?: number } };
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    if (e.code === 190) throw new TemplateError('Токен WhatsApp устарел — переподключите номер в разделе WhatsApp');
    throw new TemplateError(`Meta не приняла шаблон: ${e.error_user_msg || e.error_user_title || e.message || `ошибка ${res.status}`}`);
  }
  return data;
}

/** Аккаунт WhatsApp компании, на котором живут шаблоны. */
async function account(db: TenantClient) {
  // Аккаунт работающего номера, у которого есть рабочий токен: старые и
  // тестовые подключения без токена не годятся.
  const numbers = await db.whatsAppPhoneNumber.findMany({
    where: { status: 'CONNECTED', account: { status: { not: 'DISCONNECTED' } } },
    orderBy: { updatedAt: 'desc' },
    include: { account: true },
  });
  const accounts = numbers.length
    ? numbers.map((n) => n.account)
    : await db.whatsAppAccount.findMany({ where: { status: { not: 'DISCONNECTED' } }, orderBy: { updatedAt: 'desc' } });
  if (!accounts.length) throw new TemplateError('Сначала подключите номер WhatsApp');
  let acc = accounts[0]!;
  let token = '';
  for (const a of accounts) {
    try {
      token = decryptSecret(a.accessToken);
      acc = a;
      break;
    } catch {
      token = '';
    }
  }
  return { acc, token };
}

/** Создать шаблон и отправить его на проверку в Meta. */
export async function createTemplate(
  db: TenantClient,
  input: { title: string; text: string; category: TemplateCategory; language?: 'ru' | 'kk' },
) {
  const title = input.title.trim().slice(0, 60);
  if (!title) throw new TemplateError('Назовите шаблон, например «Трек-номер»');
  if (input.category !== 'MARKETING' && input.category !== 'UTILITY') throw new TemplateError('Выберите тип шаблона');
  const language = input.language === 'kk' ? 'kk' : 'ru';
  const { body, variables } = parseTemplateText(input.text);
  const { acc, token } = await account(db);
  const name = templateName(title);

  let status = 'APPROVED';
  let metaId: string | null = null;
  let category: string = input.category;
  if (live()) {
    if (!token) throw new TemplateError('У номера WhatsApp нет токена — переподключите его');
    const created = await graph<{ id?: string; status?: string; category?: string }>(`${acc.wabaId}/message_templates`, token, {
      method: 'POST',
      body: {
        name,
        language,
        category: input.category,
        components: [
          {
            type: 'BODY',
            text: body,
            ...(variables.length ? { example: { body_text: [variables.map(exampleFor)] } } : {}),
          },
        ],
      },
    });
    metaId = created.id ?? null;
    status = META_STATUS.has(String(created.status)) ? String(created.status) : 'PENDING';
    category = created.category === 'MARKETING' || created.category === 'UTILITY' ? created.category : input.category;
  }

  return db.messageTemplate.create({
    data: { accountId: acc.id, title, name, language, category, body, variables, status, metaId } as never,
  });
}

/** Подтянуть статусы шаблонов из Meta: одобрен, отклонён и почему. */
export async function syncTemplates(db: TenantClient) {
  if (!live()) return 0;
  const rows = await db.messageTemplate.findMany({ select: { id: true, name: true, language: true, accountId: true } });
  if (!rows.length) return 0;
  const { acc, token } = await account(db);
  if (!token) return 0;
  const list = await graph<{ data?: Array<{ id: string; name: string; language: string; status: string; category?: string; rejected_reason?: string }> }>(
    `${acc.wabaId}/message_templates?fields=id,name,language,status,category,rejected_reason&limit=200`,
    token,
  );
  let changed = 0;
  for (const t of list.data ?? []) {
    const row = rows.find((r) => r.name === t.name && r.language === t.language);
    if (!row) continue;
    await db.messageTemplate.updateMany({
      where: { id: row.id },
      data: {
        status: META_STATUS.has(t.status) ? t.status : 'PENDING',
        metaId: t.id,
        rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
        ...(t.category === 'MARKETING' || t.category === 'UTILITY' ? { category: t.category } : {}),
      },
    });
    changed += 1;
  }
  return changed;
}

/** Удалить шаблон: у нас и в Meta (там имя потом нельзя повторить месяц — поэтому у имён хвост). */
export async function deleteTemplate(db: TenantClient, id: string) {
  const row = await db.messageTemplate.findFirst({ where: { id } });
  if (!row) return;
  if (live()) {
    const { acc, token } = await account(db);
    if (token) await graph(`${acc.wabaId}/message_templates?name=${encodeURIComponent(row.name)}`, token, { method: 'DELETE' }).catch(() => {});
  }
  await db.messageTemplate.deleteMany({ where: { id } });
}

/** Почему Meta отклонила — по-человечески. */
export const REJECT_REASON: Record<string, string> = {
  ABUSIVE_CONTENT: 'Meta сочла текст недопустимым',
  INVALID_FORMAT: 'неверный формат — проверьте поля и текст вокруг них',
  PROMOTIONAL: 'это реклама — создайте шаблон с типом «Реклама и напоминания»',
  TAG_CONTENT_MISMATCH: 'текст не совпадает с выбранным типом',
  SCAM: 'Meta сочла текст подозрительным',
};
