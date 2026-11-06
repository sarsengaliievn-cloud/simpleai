'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { sendMessage, takeOver, returnToAi, markRead } from '@/app/conversations/actions';
import { initials, avatarColor, clockWithDay } from '@/lib/format';
import { CloseChat } from './CloseChat';
import { TemplateSender, type ApprovedTemplate } from './TemplateSender';

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
  /** Вложение, которое можно показать: файл отдаёт /api/media/{id}. */
  media?: { fileName: string | null; mime: string | null } | null;
};

/** Фото, видео, голосовое или файл прямо в переписке. */
function Attachment({ m }: { m: Message }) {
  const src = `/api/media/${m.id}`;
  if (!m.media) return <em className="small">Вложение: {ATTACH[m.type] ?? m.type.toLowerCase()}</em>;
  if (m.type === 'IMAGE') {
    return (
      <a href={src} target="_blank" rel="noopener" className="msg-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Фото" loading="lazy" />
      </a>
    );
  }
  if (m.type === 'VIDEO') return <video className="msg-media" src={src} controls preload="metadata" />;
  if (m.type === 'AUDIO') return <audio src={src} controls preload="none" style={{ width: 240, maxWidth: '100%' }} />;
  return (
    <a href={`${src}?download`} className="msg-file">
      <span aria-hidden>📄</span>
      <span>{m.media.fileName ?? (m.type === 'LOCATION' ? 'Геолокация' : 'Файл')}</span>
    </a>
  );
}

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
  /** Итог, если диалог закрыт: info, won, lost, spam, done. */
  closedReason?: string | null;
};

const AUTHOR: Record<string, string> = { AI: 'Ассистент', MANAGER: 'Менеджер' };
const ATTACH: Record<string, string> = {
  IMAGE: 'фото', VIDEO: 'видео', DOCUMENT: 'файл', LOCATION: 'геолокация', UNSUPPORTED: 'стикер или реакция',
};

type QuickReply = { id: string; title: string; text: string };

export function ThreadView({
  conversation,
  messages,
  quickReplies = [],
  backHref = '/conversations',
  lostReasons = [],
  dealHref,
  templates = [],
}: {
  conversation: Conversation;
  messages: Message[];
  quickReplies?: QuickReply[];
  /** На телефоне — «назад» к списку диалогов. */
  backHref?: string;
  lostReasons?: string[];
  /** На узком экране сделка прячется — кнопка «Сделка» открывает её поверх. */
  dealHref?: string;
  /** Одобренные шаблоны — для клиентов, которые молчат больше 24 часов. */
  templates?: ApprovedTemplate[];
}) {
  const [text, setText] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [quickIndex, setQuickIndex] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  // «/кат» в начале — подсказка из быстрых ответов, как в Telegram-ботах.
  const slash = text.startsWith('/') ? text.slice(1).toLowerCase() : null;
  const quickShown = quickOpen || slash !== null
    ? quickReplies.filter((q) => !slash || q.title.toLowerCase().includes(slash) || q.text.toLowerCase().includes(slash))
    : [];

  const applyQuick = (q: QuickReply) => {
    setText(slash !== null || !text.trim() ? q.text : `${text.trimEnd()}\n${q.text}`);
    setQuickOpen(false);
    setQuickIndex(0);
    requestAnimationFrame(() => box.current?.focus());
  };

  // Поле растёт под текст, но не выше 160 px.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);
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
    if (file) { sendFile(); return; }
    if (!text.trim() || pending) return;
    const body = text;
    setText('');
    setError(null);
    start(async () => {
      const result = await sendMessage(conversation.id, body);
      if (!result.ok) {
        setError(result.error);
        setText(body);
      } else router.refresh();
    });
  };

  // Файл уходит отдельным запросом: server action не принимает файлы больше 1 МБ.
  const sendFile = () => {
    if (!file || pending) return;
    const caption = text;
    setError(null);
    start(async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('caption', caption);
      const res = await fetch(`/api/conversations/${conversation.id}/media`, { method: 'POST', body: form }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        setError(json.error ?? 'Не удалось отправить файл — попробуйте ещё раз');
        return;
      }
      setFile(null);
      setText('');
      if (fileInput.current) fileInput.current.value = '';
      router.refresh();
    });
  };

  return (
    <div className="thread">
      <div className="thread-h spread">
        <div className="row">
          <a href={backHref} className="thread-back" aria-label="К списку диалогов">←</a>
          <div className="avatar" style={{ background: avatarColor(conversation.id) }}>
            {initials(conversation.customerName, '??')}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{conversation.customerName}</div>
            <div className="tiny muted">
              <a href={`tel:${conversation.customerPhone}`} className="thread-phone">{conversation.customerPhone}</a>
              {conversation.customerCity ? ` · ${conversation.customerCity}` : ''}
            </div>
          </div>
        </div>
        <div className="row thread-actions">
          {dealHref && <a href={dealHref} className="btn btn-ghost btn-sm deal-toggle">Сделка</a>}
          <CloseChat conversationId={conversation.id} closedReason={conversation.closedReason} lostReasons={lostReasons} />
          {conversation.closedReason ? null : conversation.mode === 'AI' ? (
            <button
              className="btn btn-ghost btn-sm"
              disabled={pending}
              onClick={() => start(async () => { await takeOver(conversation.id); router.refresh(); })}
            >
              Забрать диалог
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              disabled={pending}
              onClick={() => start(async () => { await returnToAi(conversation.id); router.refresh(); })}
            >
              Вернуть ассистенту
            </button>
          )}
        </div>
      </div>

      <div className="thread-b">
        {messages.map((m) =>
          m.authorType === 'SYSTEM' && m.text?.startsWith('🛒') ? (
            // Клиент готов купить — сводка для менеджера карточкой, а не мелкой строкой.
            <div key={m.id} className="order-note">{m.text}</div>
          ) : m.authorType === 'SYSTEM' ? (
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
              {m.type === 'TEMPLATE' && <span className="tiny muted" style={{ display: 'block', marginBottom: 3 }}>Шаблон</span>}
              {m.type !== 'TEXT' && m.type !== 'AUDIO' && m.type !== 'TEMPLATE' && <Attachment m={m} />}
              {m.type === 'AUDIO' && m.media && <Attachment m={m} />}
              {m.text && <span className="msg-text" style={{ marginTop: m.type !== 'TEXT' && m.type !== 'TEMPLATE' ? 4 : 0 }}>{m.text}</span>}
              <span className="msg-t" suppressHydrationWarning>
                {clockWithDay(m.createdAt)}
                {AUTHOR[m.authorType] ? ` · ${AUTHOR[m.authorType]}${m.fromPhone ? ' с телефона' : ''}` : ''}
                {m.direction === 'OUTBOUND' && <Ticks status={m.status} errorCode={m.errorCode} />}
              </span>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      <div className={`thread-f ${conversation.windowOpen ? '' : 'win-closed'}`}>
        {!conversation.windowOpen && (
          <TemplateSender conversationId={conversation.id} customerName={conversation.customerName} templates={templates} />
        )}
        {error && (
          <div className="chip chip-bad" style={{ marginBottom: 9, height: 'auto', padding: '6px 10px' }}>
            {error}
          </div>
        )}
        {file && (
          <div className="file-chip">
            <span aria-hidden>{file.type.startsWith('image/') ? '📷' : file.type.startsWith('video/') ? '🎥' : '📄'}</span>
            <span className="file-chip-n">{file.name}</span>
            <span className="tiny muted">{(file.size / 1024 / 1024).toFixed(1)} МБ · текст ниже уйдёт подписью</span>
            <button type="button" className="btn btn-quiet btn-sm" aria-label="Убрать файл"
                    onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}>✕</button>
          </div>
        )}
        <div className="row" style={{ position: 'relative', alignItems: 'flex-end' }}>
          {quickShown.length > 0 && conversation.windowOpen && (
            <div className="qr-pop" role="listbox">
              {quickShown.map((q, i) => (
                <button key={q.id} type="button" className={`qr-item ${i === quickIndex ? 'on' : ''}`}
                        onMouseDown={(e) => e.preventDefault()} onClick={() => applyQuick(q)}>
                  <b className="small">{q.title}</b>
                  <div className="tiny muted qr-text">{q.text}</div>
                </button>
              ))}
            </div>
          )}
          <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,video/mp4,video/3gpp,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                 onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
          <button type="button" className="btn btn-ghost compose-icon" title="Фото, видео или файл" aria-label="Прикрепить файл"
                  disabled={!conversation.windowOpen || pending} onClick={() => fileInput.current?.click()}>
            📎
          </button>
          {quickReplies.length > 0 && (
            <button type="button" className="btn btn-ghost compose-icon" title="Быстрые ответы" aria-label="Быстрые ответы"
                    disabled={!conversation.windowOpen || pending} onClick={() => setQuickOpen((v) => !v)}>
              ⚡
            </button>
          )}
          <textarea
            ref={box}
            rows={1}
            className="input reply-box"
            placeholder={conversation.windowOpen ? (quickReplies.length ? 'Сообщение… «/» — быстрые ответы' : 'Написать сообщение…') : 'Окно закрыто — нужен шаблон'}
            value={text}
            disabled={!conversation.windowOpen || pending}
            onChange={(e) => { setText(e.target.value); setQuickIndex(0); }}
            onBlur={() => setQuickOpen(false)}
            onKeyDown={(e) => {
              if (quickShown.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setQuickIndex((i) => (i + 1) % quickShown.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setQuickIndex((i) => (i - 1 + quickShown.length) % quickShown.length); return; }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyQuick(quickShown[quickIndex] ?? quickShown[0]!); return; }
                if (e.key === 'Escape') { setQuickOpen(false); if (slash !== null) setText(''); return; }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!conversation.windowOpen || pending || (!file && !text.trim()) || (slash !== null && quickShown.length > 0)}
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
