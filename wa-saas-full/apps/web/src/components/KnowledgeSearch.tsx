'use client';

import { useState } from 'react';

type Hit = { title: string; ordinal: number; score: number; preview: string };

export function KnowledgeSearch() {
  const [q, setQ] = useState('Есть ли доставка в Астану?');
  const [data, setData] = useState<{ hits: Hit[]; answer: string; confidence: number; threshold: number; needsHuman: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error);
      else setData(json);
    } catch {
      setError('Не удалось выполнить запрос');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card card-p">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Проверка поиска</div>
      <p className="small muted" style={{ marginBottom: 14 }}>
        Видно, что именно ассистент нашёл и насколько это подошло. Нужно, чтобы понимать, почему он ответил так.
      </p>

      <div className="row" style={{ marginBottom: 16 }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && run()} />
        <button className="btn btn-primary" onClick={run} disabled={loading}>
          {loading ? '…' : 'Найти'}
        </button>
      </div>

      {error && <div className="chip chip-bad" style={{ height: 'auto', padding: '7px 11px' }}>{error}</div>}

      {data?.hits.map((h, i) => (
        <div key={i} style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', marginBottom: 10 }}>
          <div className="spread" style={{ marginBottom: 6 }}>
            <div className="row">
              <span className="small" style={{ fontWeight: 600 }}>{h.title}</span>
              <span className="chip">фрагмент {h.ordinal}</span>
            </div>
            <span className="mono small" style={{ fontWeight: 600, color: h.score > 60 ? 'var(--pine)' : 'var(--muted)' }}>
              {h.score}%
            </span>
          </div>
          <p className="small muted">{h.preview}…</p>
        </div>
      ))}

      {data && (
        <div className="card card-p" style={{ background: data.needsHuman ? 'var(--amber-soft)' : 'var(--pine-soft)', borderColor: 'transparent', marginTop: 14 }}>
          <div className="tiny" style={{ fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 8, color: data.needsHuman ? 'var(--amber)' : 'var(--pine-600)' }}>
            {data.needsHuman ? `Ушло бы менеджеру — ${data.confidence}% при пороге ${data.threshold}%` : `Ответ · уверенность ${data.confidence}%`}
          </div>
          <p className="small">
            {data.answer || 'Ответа в базе знаний нет. Ассистент не стал придумывать и позвал бы человека.'}
          </p>
        </div>
      )}
    </div>
  );
}
