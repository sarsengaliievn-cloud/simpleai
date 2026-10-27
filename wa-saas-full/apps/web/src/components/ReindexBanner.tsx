'use client';

import { useState, useTransition } from 'react';
import { reindexAll } from '@/app/knowledge/actions';

/** Сменили AI-провайдера — база знаний построена старым, её нужно обновить. */
export function ReindexBanner({ count, provider }: { count: number; provider: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <div className="notice notice-warn" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
      <span style={{ flex: 1, minWidth: 240 }}>
        {done
          ? 'Индекс обновляется — статус документов сменится на «Готов» через минуту-две.'
          : `Ассистент теперь работает на ${provider}, а ${count} док. проиндексированы старым. Пока индекс не обновлён, бот не найдёт ответы в базе знаний.`}
      </span>
      {!done && (
        <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => { await reindexAll(); setDone(true); })}>
          {pending ? 'Запускаю…' : 'Обновить индекс'}
        </button>
      )}
    </div>
  );
}
