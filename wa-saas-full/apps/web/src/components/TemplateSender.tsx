'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendTemplateAction } from '@/app/conversations/actions';

export type ApprovedTemplate = { id: string; title: string; body: string; variables: string[] };

/**
 * Окно 24 часа закрыто: свободный текст Meta не примет, только шаблон.
 * Имя клиента подставляется само, остальное (трек-номер) — вписать.
 */
export function TemplateSender({ conversationId, customerName, templates }: { conversationId: string; customerName: string; templates: ApprovedTemplate[] }) {
  const router = useRouter();
  const [id, setId] = useState(templates[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tpl = templates.find((t) => t.id === id);
  const name = /^\+?\d[\d\s]+$/.test(customerName) ? '' : customerName;

  if (templates.length === 0) {
    return (
      <div className="tpl-send">
        <div className="small">
          Клиент не писал больше 24 часов — WhatsApp пропустит только одобренный шаблон.{' '}
          <a href="/settings#templates">Создать шаблон</a> или напишите клиенту с телефона из приложения WhatsApp Business.
        </div>
      </div>
    );
  }

  const value = (label: string) => values[label] ?? (label === 'имя' ? name : '');
  const preview = tpl ? tpl.body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
    const label = tpl.variables[Number(n) - 1] ?? '';
    return value(label) || (label === 'имя' ? 'уважаемый клиент' : `{${label}}`);
  }) : '';

  return (
    <div className="tpl-send">
      <div className="small">Клиент не писал больше 24 часов — можно отправить только шаблон. Ответит — снова пишите что угодно.</div>
      {error && <div className="notice notice-bad" style={{ margin: 0 }}>{error}</div>}
      <div className="row">
        <select className="select" value={id} onChange={(e) => { setId(e.target.value); setError(null); }} aria-label="Шаблон">
          {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        {tpl?.variables.map((label) => (
          <input key={label} className="input" value={value(label)} placeholder={label === 'имя' ? 'Имя клиента' : label[0]!.toUpperCase() + label.slice(1)}
                 onChange={(e) => setValues({ ...values, [label]: e.target.value })} aria-label={label} />
        ))}
        <button className="btn btn-primary" disabled={pending || !tpl} onClick={() => start(async () => {
          setError(null);
          const filled = Object.fromEntries((tpl?.variables ?? []).map((l) => [l, value(l)]));
          const r = await sendTemplateAction(conversationId, id, filled);
          if (!r.ok) setError(r.error);
          else { setValues({}); router.refresh(); }
        })}>
          {pending ? 'Отправляю…' : 'Отправить шаблон'}
        </button>
      </div>
      {preview && <div className="tpl-preview" style={{ margin: 0 }}>{preview}</div>}
    </div>
  );
}
