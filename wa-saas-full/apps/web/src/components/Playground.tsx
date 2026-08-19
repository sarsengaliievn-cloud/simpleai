'use client';

import { useState } from 'react';

type Turn = {
  role: 'user' | 'assistant';
  content: string;
  confidence?: number;
  needsHuman?: boolean;
  sources?: string[];
};

export function Playground({ tone, threshold, documents }: { tone: string; threshold: number; documents: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const question = text.trim();
    if (!question || loading) return;

    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: 'user', content: question }]);
    setText('');
    setLoading(true);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });
      const json = await res.json();

      setTurns((prev) => [
        ...prev,
        res.ok
          ? {
              role: 'assistant',
              content: json.answer || 'В базе знаний нет ответа на этот вопрос — передал бы менеджеру.',
              confidence: json.confidence,
              needsHuman: json.needsHuman,
              sources: json.hits?.slice(0, 2).map((h: { title: string }) => h.title),
            }
          : { role: 'assistant', content: json.error ?? 'Ошибка' },
      ]);
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', content: 'Сеть недоступна' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="split">
      <div className="split-l">
        <div style={{ fontWeight: 700, marginBottom: 14 }}>Что сейчас настроено</div>
        {[['Стиль', tone], ['Порог уверенности', `${threshold}%`], ['Документов в базе', String(documents)]].map(([k, v]) => (
          <div className="spread small" key={k} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <span className="muted">{k}</span>
            <span style={{ fontWeight: 600 }}>{v}</span>
          </div>
        ))}
        <div className="card card-p" style={{ background: 'var(--surface-2)', border: 'none', marginTop: 16 }}>
          <p className="small muted">
            Спрашивайте то же, что спрашивают клиенты. Если ассистент зовёт менеджера — значит,
            в базе знаний дырка: её видно здесь, а не в переписке с покупателем.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 14, width: '100%' }} onClick={() => setTurns([])}>
          Очистить диалог
        </button>
      </div>

      <div className="split-r">
        <div className="thread-b" style={{ flex: 1 }}>
          {turns.length === 0 && (
            <div className="empty">
              <h3>Задайте вопрос</h3>
              <p>«Есть 42 размер?», «Доставка в Астану сколько идёт?», «Можно вернуть без чека?»</p>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <div className={`msg ${t.role === 'user' ? 'msg-in' : 'msg-out'}`}>{t.content}</div>
              {t.role === 'assistant' && t.confidence !== undefined && (
                <div className="tiny muted" style={{ alignSelf: 'flex-end', marginTop: -5 }}>
                  уверенность {t.confidence}%
                  {t.needsHuman ? ' · ушло бы менеджеру' : ''}
                  {t.sources?.length ? ` · ${t.sources.join(', ')}` : ''}
                </div>
              )}
            </div>
          ))}

          {loading && <div className="msg msg-out" style={{ opacity: 0.6 }}>…</div>}
        </div>

        <div className="thread-f">
          <div className="row">
            <input className="input" placeholder="Написать как клиент…" value={text}
                   onChange={(e) => setText(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button className="btn btn-primary" onClick={send} disabled={loading || !text.trim()}>Отправить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
