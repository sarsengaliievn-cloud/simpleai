'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTemplateAction, deleteTemplateAction, syncTemplatesAction } from '@/app/settings/actions';

export type TemplateRow = {
  id: string;
  title: string;
  language: string;
  category: string;
  body: string;
  variables: string[];
  status: string;
  rejectedReason: string | null;
};

const STATUS: Record<string, [string, string]> = {
  PENDING: ['chip-warn', 'На проверке в Meta'],
  IN_APPEAL: ['chip-warn', 'Обжалуется'],
  APPROVED: ['chip-ok', 'Одобрен — можно отправлять'],
  REJECTED: ['chip-bad', 'Отклонён'],
  PAUSED: ['chip-bad', 'Приостановлен Meta'],
  DISABLED: ['chip-bad', 'Отключён Meta'],
};
const REASON: Record<string, string> = {
  ABUSIVE_CONTENT: 'Meta сочла текст недопустимым',
  INVALID_FORMAT: 'неверный формат — проверьте поля и текст вокруг них',
  PROMOTIONAL: 'это реклама — создайте с типом «Напоминание, акции»',
  TAG_CONTENT_MISMATCH: 'текст не подходит к выбранному типу',
  SCAM: 'Meta сочла текст подозрительным',
};

/** {{1}} → {имя}: владелец видит шаблон так же, как писал. */
const human = (t: Pick<TemplateRow, 'body' | 'variables'>) => t.body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => `{${t.variables[Number(n) - 1] ?? n}}`);

const presets = (company: string) => [
  {
    title: 'Напоминание о себе',
    category: 'MARKETING',
    text: `Здравствуйте, {имя}! Это ${company}. Вы недавно писали нам — подсказать по размеру или наличию? Ответьте на это сообщение, и мы поможем с выбором.`,
    hint: 'клиент спрашивал и пропал',
  },
  {
    title: 'Трек-номер',
    category: 'UTILITY',
    text: `Здравствуйте, {имя}! Ваш заказ в ${company} отправлен. Трек-номер: {трек}. Отследить посылку можно на сайте Казпочты. Если будут вопросы — ответьте на это сообщение.`,
    hint: 'заказ отправлен',
  },
];

/**
 * Шаблоны WhatsApp: клиенту, который молчит больше суток, можно написать
 * только одобренным текстом. Поля пишутся словами: {имя} подставится само,
 * остальное (например {трек}) менеджер впишет при отправке.
 */
export function TemplatesManager({ templates, company }: { templates: TemplateRow[]; company: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [language, setLanguage] = useState<'ru' | 'kk'>('ru');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const preview = text.replace(/\{\s*имя\s*\}/gi, 'Айгерим').replace(/\{\s*трек\s*\}/gi, 'RB123456789KZ');

  return (
    <section className="card card-p" style={{ marginBottom: 16 }} id="templates">
      <div className="spread" style={{ marginBottom: 4 }}>
        <div style={{ fontWeight: 700 }}>Шаблоны WhatsApp</div>
        {templates.length > 0 && (
          <button className="btn btn-quiet btn-sm" disabled={pending} onClick={() => start(async () => {
            const r = await syncTemplatesAction();
            setMsg(r.ok ? { ok: true, text: 'Статусы обновлены' } : { ok: false, text: r.error ?? 'Ошибка' });
            router.refresh();
          })}>Проверить статус</button>
        )}
      </div>
      <p className="small muted" style={{ marginBottom: 14, maxWidth: '72ch' }}>
        Если клиент не писал больше 24 часов, WhatsApp пропускает только одобренный Meta текст. Когда клиент ответит — снова можно писать что угодно.
        Проверка обычно занимает от нескольких минут до суток. Meta берёт плату за каждый отправленный шаблон: о заказе — дешевле, напоминания и акции — дороже.
      </p>
      {msg && <div className={`notice ${msg.ok ? 'notice-ok' : 'notice-bad'}`}>{msg.text}</div>}

      {templates.length > 0 && (
        <ul className="tpl-list" style={{ marginBottom: 16 }}>
          {templates.map((t) => {
            const [cls, label] = STATUS[t.status] ?? ['chip', t.status];
            return (
              <li key={t.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <b>{t.title}</b>
                    <span className={`chip ${cls}`}>{label}</span>
                    <span className="tiny muted">{t.category === 'UTILITY' ? 'о заказе' : 'напоминание, акции'} · {t.language === 'kk' ? 'қазақша' : 'русский'}</span>
                  </div>
                  <div className="small muted qr-text">{human(t)}</div>
                  {t.status === 'REJECTED' && t.rejectedReason && (
                    <div className="tiny danger">Причина: {REASON[t.rejectedReason] ?? t.rejectedReason}</div>
                  )}
                </div>
                <button className="btn btn-quiet btn-sm danger" disabled={pending}
                        onClick={() => start(async () => { await deleteTemplateAction(t.id); router.refresh(); })}>
                  Удалить
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="tiny muted" style={{ marginBottom: 6 }}>Готовые — нажмите, чтобы подставить и поправить под себя:</div>
      <div className="tpl-presets">
        {presets(company).map((p) => (
          <button key={p.title} type="button" className="tpl-preset" onClick={() => { setTitle(p.title); setText(p.text); setCategory(p.category as 'MARKETING' | 'UTILITY'); setMsg(null); }}>
            <b>{p.title}</b><span>{p.hint}</span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createTemplateAction({ title, text, category, language });
            if (r.ok) {
              setMsg({ ok: true, text: r.status === 'APPROVED' ? 'Шаблон одобрен — можно отправлять' : 'Шаблон отправлен на проверку в Meta. Статус появится здесь — нажмите «Проверить статус» чуть позже.' });
              setTitle('');
              setText('');
              router.refresh();
            } else setMsg({ ok: false, text: r.error });
          });
        }}
      >
        <label className="field">
          <span className="label">Название</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={60} placeholder="Трек-номер" />
        </label>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label className="field">
            <span className="label">Тип</span>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value as 'MARKETING' | 'UTILITY')}>
              <option value="MARKETING">Напоминание, акции</option>
              <option value="UTILITY">О заказе: отправлен, трек, оплата</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Язык</span>
            <select className="select" value={language} onChange={(e) => setLanguage(e.target.value as 'ru' | 'kk')}>
              <option value="ru">Русский</option>
              <option value="kk">Қазақша</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span className="label">Текст</span>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} required maxLength={1024} style={{ minHeight: 100 }}
                    placeholder="Здравствуйте, {имя}! Ваш заказ отправлен. Трек-номер: {трек}. Отследить можно на сайте Казпочты." />
          <span className="hint">
            {'{имя}'} — имя клиента, подставится само. Любое другое слово в фигурных скобках, например {'{трек}'}, менеджер впишет при отправке.
            Нельзя начинать или заканчивать текст полем.
          </span>
        </label>
        {text.trim() && <div className="tpl-preview"><span className="tiny muted">Клиент увидит:</span><br />{preview}</div>}
        <button className="btn btn-primary" type="submit" disabled={pending || !title.trim() || !text.trim()}>
          {pending ? 'Отправляю…' : 'Отправить на проверку в Meta'}
        </button>
      </form>
    </section>
  );
}
