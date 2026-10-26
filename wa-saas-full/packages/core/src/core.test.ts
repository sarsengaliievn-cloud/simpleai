import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseMetaWebhook, verifyMetaSignature } from '@wa/whatsapp';
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
