'use client';

import { useState, useTransition } from 'react';
import { saveCatalogAction, type CatalogResult } from '@/app/assistant/actions';

/**
 * Каталог склада для ответов бота: «есть 42?», «подберите зимние женские».
 * Ссылка проверяется при сохранении — сразу видно, сколько моделей нашлось.
 */
export function CatalogSettings({ initial }: { initial: { url: string; productUrl: string; photoUrl: string; photos: boolean } }) {
  const [url, setUrl] = useState(initial.url);
  const [productUrl, setProductUrl] = useState(initial.productUrl);
  const [photoUrl, setPhotoUrl] = useState(initial.photoUrl);
  const [photos, setPhotos] = useState(initial.photos);
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [pending, start] = useTransition();

  const save = (next?: Partial<{ url: string }>) =>
    start(async () => {
      setResult(await saveCatalogAction({ url: next?.url ?? url, productUrl, photoUrl, photos }));
    });

  return (
    <div className="card card-p" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Склад: наличие и подбор моделей</div>
      <p className="small muted" style={{ marginBottom: 14, maxWidth: '68ch' }}>
        С каталогом бот сам отвечает «есть ли 42 размер» — по магазинам — и подбирает модели по сезону, полу и размеру.
        Цены и наличие берутся только отсюда, раз в 5 минут обновляются. Резерв бот не ставит.
      </p>
      {result && (
        <div className={`notice ${result.ok ? 'notice-ok' : 'notice-bad'}`}>
          {result.ok
            ? result.models
              ? <>Каталог подключён: {result.models} моделей{result.stores.length ? `, магазины: ${result.stores.join('; ')}` : ''}.<br /><span className="tiny">Например: {result.sample}</span></>
              : 'Каталог отключён — бот отвечает только по базе знаний.'
            : result.error}
        </div>
      )}
      <label className="field">
        <span className="label">Ссылка на каталог (JSON)</span>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/publicCatalog" />
        <span className="hint">Выгрузка моделей с размерами и наличием по магазинам. Пусто — без склада.</span>
      </label>
      <label className="field">
        <span className="label">Ссылка на модель для клиента</span>
        <input className="input" value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://магазин.kz/shop/#p={id}" />
        <span className="hint">Бот добавит её к ответу. Вместо {'{id}'} подставится номер модели.</span>
      </label>
      <label className="field">
        <span className="label">Ссылка на фото модели</span>
        <input className="input" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…/publicPhoto?id={id}&size=full" />
      </label>
      <label className="row" style={{ gap: 8, marginBottom: 14 }}>
        <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} />
        <span className="small">При подборе отправлять фото моделей (до трёх)</span>
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => save()}>
          {pending ? 'Проверяю каталог…' : 'Проверить и сохранить'}
        </button>
        {initial.url && (
          <button type="button" className="btn btn-quiet btn-sm" disabled={pending} onClick={() => { setUrl(''); save({ url: '' }); }}>
            Отключить склад
          </button>
        )}
      </div>
    </div>
  );
}
