'use client';

import { useRef, useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { editDocumentText, getDocumentText, replaceDocument, removeDocument } from '@/app/knowledge/actions';

/**
 * Действия с документом базы: скачать, поправить прямо здесь, заменить
 * файлом, удалить. Правка и замена переиндексируют только этот документ —
 * пока индекс строится, бот отвечает по старому тексту.
 */
export function KnowledgeDocActions({ id, title }: { id: string; title: string }) {
  const [edit, setEdit] = useState<{ title: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) setEdit(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [edit, pending]);

  const open = () => {
    setError(null);
    start(async () => {
      const r = await getDocumentText(id).catch(() => ({ ok: false as const, error: 'Не удалось открыть документ' }));
      if (r.ok) setEdit({ title: r.title, text: r.text });
      else setError(r.error);
    });
  };

  const save = () => {
    if (!edit) return;
    setError(null);
    start(async () => {
      const r = await editDocumentText(id, edit.title, edit.text).catch(() => ({ ok: false as const, error: 'Не удалось сохранить. Попробуйте ещё раз.' }));
      if (!r.ok) { setError(r.error); return; }
      setEdit(null);
      setTimeout(() => router.refresh(), 1200);
    });
  };

  const replace = (file: File) => {
    if (file.size > 20 * 1024 * 1024) { setError('Файл больше 20 МБ'); return; }
    const data = new FormData();
    data.set('file', file);
    setError(null);
    start(async () => {
      const r = await replaceDocument(id, data).catch(() => ({ ok: false as const, error: 'Не удалось загрузить файл' }));
      if (fileRef.current) fileRef.current.value = '';
      if (!r.ok) setError(r.error);
      else setTimeout(() => router.refresh(), 1200);
    });
  };

  return (
    <>
      <div className="kb-acts">
        <a className="btn btn-quiet btn-sm" href={`/api/knowledge/export?id=${id}`} download title="Скачать текстом">Скачать</a>
        <button className="btn btn-quiet btn-sm" type="button" onClick={open} disabled={pending}>Изменить</button>
        <button className="btn btn-quiet btn-sm" type="button" onClick={() => fileRef.current?.click()} disabled={pending} title="Загрузить новый файл вместо этого">
          {pending && !edit ? '…' : 'Заменить'}
        </button>
        <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.xlsx,.xls,.txt,.csv,.md"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) replace(f); }} />
        <form action={removeDocument.bind(null, id)} onSubmit={(e) => { if (!confirm(`Удалить «${title}» из базы знаний?`)) e.preventDefault(); }}>
          <button className="btn btn-quiet btn-sm" type="submit">Удалить</button>
        </form>
      </div>
      {error && !edit && <div className="tiny" style={{ color: 'var(--red)', marginTop: 4 }}>{error}</div>}

      {edit && (
        <div className="modal-scrim" onClick={() => !pending && setEdit(null)}>
          <div className="modal kb-modal" role="dialog" aria-modal="true" aria-label={`Изменить «${title}»`} onClick={(e) => e.stopPropagation()}>
            <h2 className="card-t">Изменить документ</h2>
            {error && <div className="notice notice-bad">{error}</div>}
            <label className="field">
              <span className="label">Название</span>
              <input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Текст</span>
              <textarea className="textarea kb-text" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
              <span className="hint">После сохранения документ проиндексируется заново — обычно это меньше минуты.</span>
            </label>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setEdit(null)} disabled={pending}>Отмена</button>
              <button className="btn btn-primary" type="button" onClick={save} disabled={pending}>{pending ? 'Сохраняю…' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
