import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseMetaWebhook, parseMetaStatuses, verifyMetaSignature, CloudApiWhatsAppProvider, WhatsAppSendError } from '@wa/whatsapp';
import { chunkText } from './ai/chunk.js';
import { normalizeHistory } from './ai/rag.js';
import { buildSystemPrompt } from './ai/prompt.js';
import { isWindowOpen, windowExpiryFrom } from './whatsapp-window.js';
import { encryptSecret, decryptSecret, maskSecret } from './crypto.js';

/** Тесты без базы и сети — гоняются за секунду перед каждым деплоем. */

describe('окно 24 часа', () => {
  it('открыто сразу после сообщения клиента и закрыто через сутки', () => {
    const inbound = new Date('2026-01-01T10:00:00Z');
    const expires = windowExpiryFrom(inbound);
    expect(isWindowOpen(expires, new Date('2026-01-02T09:59:00Z'))).toBe(true);
    expect(isWindowOpen(expires, new Date('2026-01-02T10:01:00Z'))).toBe(false);
    expect(isWindowOpen(null)).toBe(false);
  });
});

describe('история для модели', () => {
  it('начинается с клиента и не содержит двух реплик одной стороны подряд', () => {
    const out = normalizeHistory([
      { role: 'assistant', content: 'Здравствуйте!' },
      { role: 'user', content: 'Есть 42?' },
      { role: 'user', content: 'Чёрные' },
      { role: 'assistant', content: 'Есть' },
      { role: 'user', content: '  ' },
    ]);
    expect(out[0]?.role).toBe('user');
    expect(out).toHaveLength(2);
    expect(out[0]?.content).toBe('Есть 42?\nЧёрные');
  });
});

describe('нарезка базы знаний', () => {
  it('режет длинный текст на куски не длиннее ~800 символов и ничего не теряет', () => {
    const paragraph = 'Доставка по Алматы на следующий день. '.repeat(60);
    const chunks = chunkText(`${paragraph}\n\nВозврат в течение 14 дней по чеку.`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(900);
    expect(chunks.join(' ')).toContain('Возврат в течение 14 дней');
  });

  it('пустой текст — пустой список', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});

describe('системная инструкция', () => {
  const base = {
    role: 'Консультант', goals: [], tone: 'Дружелюбный', languages: ['ru', 'kk'],
    forbidden: '', extraRules: 'Предлагай доставку', advancedMode: false, advancedPrompt: '',
  };

  it('запрет выдумывать есть всегда, даже в ручном режиме', () => {
    expect(buildSystemPrompt(base, { name: 'Demo' })).toContain('не придумывай');
    const manual = buildSystemPrompt({ ...base, advancedMode: true, advancedPrompt: 'Ты бот' }, { name: 'Demo' });
    expect(manual).toContain('Ты бот');
    expect(manual).toContain('не придумывай');
  });

  it('дополнительные правила попадают в инструкцию', () => {
    expect(buildSystemPrompt(base, { name: 'Demo' })).toContain('Предлагай доставку');
  });
});

describe('шифрование токенов', () => {
  it('расшифровывает своё и не показывает токен целиком', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const secret = 'EAAGtokenvalue123456';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
    expect(maskSecret(secret)).toBe('EAAG••••3456');
  });
});

describe('вебхук Meta', () => {
  const body = JSON.stringify({ entry: [] });

  it('подпись проверяется по секрету приложения', () => {
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
    expect(verifyMetaSignature(body, sig, 'app-secret')).toBe(true);
    expect(verifyMetaSignature(body, sig, 'other-secret')).toBe(false);
    expect(verifyMetaSignature(body, null, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=zz', 'app-secret')).toBe(false);
  });

  it('кнопки и подписи к фото разбираются как текст', () => {
    const parsed = parseMetaWebhook({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '123' },
        messages: [
          { id: 'a', from: '7701', type: 'image', image: { id: 'm1', caption: 'Такие есть?' }, timestamp: '1700000000' },
          { id: 'b', from: '7701', type: 'interactive', interactive: { button_reply: { title: 'Да, оформить' } }, timestamp: '1700000001' },
          { id: 'c', from: '7701', type: 'button', button: { text: 'Позвоните мне' }, timestamp: '1700000002' },
        ],
      } }] }],
    });
    expect(parsed.map((m) => [m.type, m.text])).toEqual([
      ['image', 'Такие есть?'],
      ['text', 'Да, оформить'],
      ['text', 'Позвоните мне'],
    ]);
  });

  it('статусы доставки не считаются входящими сообщениями', () => {
    const parsed = parseMetaWebhook({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' }, statuses: [{ id: 'x', status: 'read' }] } }] }],
    });
    expect(parsed).toEqual([]);
  });
});

describe('WhatsApp Cloud API', () => {
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const reply = (status: number, body: unknown) =>
    (globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

  afterEach(() => {
    globalThis.fetch = realFetch;
    calls.length = 0;
  });

  it('отправляет текст с токеном компании и возвращает id Meta', async () => {
    reply(200, { messages: [{ id: 'wamid.OK' }] });
    const res = await new CloudApiWhatsAppProvider().sendText({ phoneNumberId: '123', to: '77010000000', text: 'Привет', accessToken: 'TOKEN' });
    expect(res.providerMessageId).toBe('wamid.OK');
    expect(calls[0]!.url).toMatch(/\/123\/messages$/);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ messaging_product: 'whatsapp', to: '77010000000', type: 'text', text: { body: 'Привет' } });
  });

  it('ошибки Meta переводятся в понятный текст', async () => {
    const p = new CloudApiWhatsAppProvider();
    const send = () => p.sendText({ phoneNumberId: '1', to: '2', text: 'x', accessToken: 't' });

    reply(401, { error: { code: 190, message: 'Error validating access token' } });
    await expect(send()).rejects.toMatchObject({ code: '190', authProblem: true, retryable: false });

    reply(400, { error: { code: 131047, message: 'Re-engagement message' } });
    await expect(send()).rejects.toMatchObject({ code: '131047', userMessage: expect.stringContaining('24 часов') });

    reply(429, { error: { code: 130429, message: 'Rate limit hit' } });
    await expect(send()).rejects.toMatchObject({ retryable: true });
  });

  it('без токена ничего не отправляет', async () => {
    reply(200, {});
    await expect(new CloudApiWhatsAppProvider().sendText({ phoneNumberId: '1', to: '2', text: 'x' })).rejects.toBeInstanceOf(WhatsAppSendError);
    expect(calls).toHaveLength(0);
  });

  it('без секрета приложения вебхук закрыт', () => {
    const before = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    expect(new CloudApiWhatsAppProvider().verifySignature('{}', 'sha256=00')).toBe(false);
    if (before !== undefined) process.env.META_APP_SECRET = before;
  });

  it('статусы разбираются вместе с кодом ошибки', () => {
    const statuses = parseMetaStatuses({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '123' },
        statuses: [
          { id: 'wamid.A', status: 'read', timestamp: '1700000000' },
          { id: 'wamid.B', status: 'failed', timestamp: '1700000001', errors: [{ code: 131026, title: 'Message undeliverable' }] },
          { id: 'wamid.C', status: 'weird' },
        ],
      } }] }],
    });
    expect(statuses.map((s) => [s.providerMessageId, s.status, s.errorCode ?? null])).toEqual([
      ['wamid.A', 'read', null],
      ['wamid.B', 'failed', '131026'],
    ]);
  });

  it('имя клиента берётся по его номеру, а не первое в списке', () => {
    const parsed = parseMetaWebhook({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '123' },
        contacts: [{ wa_id: '7701', profile: { name: 'Айгерим' } }, { wa_id: '7702', profile: { name: 'Данияр' } }],
        messages: [
          { id: 'a', from: '7702', type: 'text', text: { body: 'привет' }, timestamp: '1700000000' },
          { id: 'b', from: '7701', type: 'text', text: { body: 'салем' } },
        ],
      } }] }],
    });
    expect(parsed.map((m) => m.profileName)).toEqual(['Данияр', 'Айгерим']);
    expect(Number.isNaN(parsed[1]!.timestamp.getTime())).toBe(false);
  });
});
