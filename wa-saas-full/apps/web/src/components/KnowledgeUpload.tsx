'use client';

import { useState, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadDocument, addManualNote } from '@/app/knowledge/actions';

export function KnowledgeUpload() {
  const [tab, setTab] = useState<'file' | 'manual'>('file');
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const submitFile = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.set('file', file);
    setError(null);
    start(async () => {
      const result = await uploadDocument(data);
      if (!result.ok) setError(result.error);
      else {
        if (fileRef.current) fileRef.current.value = '';
        // Индексация идёт в воркере — обновляем, чтобы увидеть смену статуса.
        setTimeout(() => router.refresh(), 1500);
      }
    });
  };

  const submitNote = () => {
    setError(null);
    start(async () => {
      const result = await addManualNote(title, text);
      if (!result.ok) setError(result.error);
      else { setTitle(''); setText(''); setTimeout(() => router.refresh(), 1500); }
    });
  };

  return (
    <div className="card card-p">
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={`tab ${tab === 'file' ? 'on' : ''}`} onClick={() => setTab('file')}>Файл</button>
        <button className={`tab ${tab === 'manual' ? 'on' : ''}`} onClick={() => setTab('manual')}>Своими словами</button>
      </div>

      {error && (
        <div className="chip chip-bad" style={{ height: 'auto', padding: '7px 11px', marginBottom: 12 }}>{error}</div>
      )}

      {tab === 'file' ? (
        <>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.txt,.csv,.md" className="input"
                 style={{ paddingTop: 9, marginBottom: 12 }} />
          <button className="btn btn-primary" onClick={submitFile} disabled={pending}>
            {pending ? 'Загружаю…' : 'Загрузить и проиндексировать'}
          </button>
          <p className="hint">PDF, DOCX, XLSX, TXT, CSV, MD — до 20 МБ. Скан без текстового слоя не подойдёт: нужен OCR.</p>
        </>
      ) : (
        <>
          <label className="field">
            <span className="label">Название</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Условия доставки" />
          </label>
          <label className="field">
            <span className="label">Текст</span>
            <textarea className="textarea" style={{ minHeight: 150 }} value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Доставка по Алматы — на следующий день, 1 500 ₸…" />
          </label>
          <button className="btn btn-primary" onClick={submitNote} disabled={pending}>
            {pending ? 'Сохраняю…' : 'Сохранить и проиндексировать'}
          </button>
        </>
      )}
    </div>
  );
}
