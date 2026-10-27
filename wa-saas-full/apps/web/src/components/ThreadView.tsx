'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { sendMessage, takeOver, returnToAi, markRead } from '@/app/conversations/actions';
import { initials, avatarColor, clockWithDay } from '@/lib/format';

type Message = {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  authorType: 'CUSTOMER' | 'AI' | 'MANAGER' | 'SYSTEM';
  text: string | null;
  type: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  errorCode: string | null;
  createdAt: Date;
  /** Менеджер написал из приложения WhatsApp на телефоне. */
  fromPhone?: boolean;
};

/** Как в самом WhatsApp: одна галочка — отправлено, две — доставлено, синие — прочитано. */
function Ticks({ status, errorCode }: { status: Message['status']; errorCode: string | null }) {
  if (status === 'FAILED') {
    return <span style={{ color: 'var(--red)', fontWeight: 700 }} title={errorCode ? `Код Meta ${errorCode}` : undefined}> · не доставлено</span>;
  }
  if (status === 'READ') return <span style={{ color: '#3B9EE8' }} title="Прочитано"> ✓✓</span>;
  if (status === 'DELIVERED') return <span title="Доставлено"> ✓✓</span>;
  if (status === 'SENT') return <span title="Отправлено"> ✓</span>;
  return <span title="Отправляется"> ⏱</span>;
}

type Conversation = {
  id: string;
  mode: 'AI' | 'HUMAN';
  windowOpen: boolean;
  windowExpiresAt: Date | null;
  customerName: string;
  customerPhone: string;
  customerCity: string | null;
};

const AUTHOR: Record<string, string> = { AI: 'Ассистент', MANAGER: 'Менеджер' };
const ATTACH: Record<string, string> = {
  IMAGE: 'фото', VIDEO: 'видео', DOCUMENT: 'файл', LOCATION: 'геолокация', UNSUPPORTED: 'стикер или реакция',
};

export function ThreadView({
  conversation,
  messages,
}: {
  conversation: Conversation;
  messages: Message[];
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void markRead(conversation.id);
  }, [conversation.id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const submit = () => {
    if (!text.trim() || pending) return;
    const body = text;
    setText('');
    setError(null);
    start(async () => {
      const result = await sendMessage(conversation.id, body);
      if (!result.ok) {
        setError(result.error);
        setText(body);
      }
    });
  };

  return (
    <div className="thread">
      <div className="thread-h spread">
        <div className="row">
          <div className="avatar" style={{ background: avatarColor(conversation.id) }}>
            {initials(conversation.customerName, '??')}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{conversation.customerName}</div>
            <div className="tiny muted">
              {conversation.customerPhone}
              {conversation.customerCity ? ` · ${conversation.customerCity}` : ''}
            </div>
          </div>
        </div>
        <div className="row">
          {conversation.mode === 'AI' ? (
            <button
              className="btn btn-ghost btn-sm"
              disabled={pending}
              onClick={() => start(() => takeOver(conversation.id))}
            >
              Забрать диалог
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              disabled={pending}
              onClick={() => start(() => returnToAi(conversation.id))}
            >
              Вернуть ассистенту
            </button>
          )}
        </div>
      </div>

      <div className="thread-b">
        {messages.map((m) =>
          m.authorType === 'SYSTEM' ? (
            <div key={m.id} className="tiny muted" style={{ textAlign: 'center', padding: '6px 0' }}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`msg ${m.direction === 'INBOUND' ? 'msg-in' : 'msg-out'}`}>
              {m.type === 'AUDIO' && (
                <span className="tiny muted" style={{ display: 'block', marginBottom: m.text ? 3 : 0 }}>
                  {m.text ? 'Голосовое · расшифровка' : 'Голосовое сообщение'}
                </span>
              )}
              {m.text ?? (m.type === 'AUDIO' ? null : <em className="small">Вложение: {ATTACH[m.type] ?? m.type.toLowerCase()}</em>)}
              <span className="msg-t">
                {clockWithDay(m.createdAt)}
                {AUTHOR[m.authorType] ? ` · ${AUTHOR[m.authorType]}${m.fromPhone ? ' с телефона' : ''}` : ''}
                {m.direction === 'OUTBOUND' && <Ticks status={m.status} errorCode={m.errorCode} />}
              </span>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      <div className="thread-f">
        {error && (
          <div className="chip chip-bad" style={{ marginBottom: 9, height: 'auto', padding: '6px 10px' }}>
            {error}
          </div>
        )}
        <div className="row">
          <input
            className="input"
            placeholder={conversation.windowOpen ? 'Написать сообщение…' : 'Окно закрыто — нужен шаблон'}
            value={text}
            disabled={!conversation.windowOpen || pending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!conversation.windowOpen || pending || !text.trim()}
          >
            {pending ? 'Отправляю…' : 'Отправить'}
          </button>
        </div>
        <div className="tiny muted" style={{ marginTop: 7 }}>
          {conversation.windowOpen
            ? `Окно 24 часа открыто до ${conversation.windowExpiresAt ? clockWithDay(conversation.windowExpiresAt) : '—'}.`
            : 'Прошло больше 24 часов с последнего сообщения клиента. Свободный текст Meta не примет — только утверждённый шаблон.'}
        </div>
      </div>
    </div>
  );
}
