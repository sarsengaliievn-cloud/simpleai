'use client';

import { useState, useTransition } from 'react';
import { saveModelAction } from '@/app/assistant/actions';

export type ModelOption = {
  id: string;
  provider: 'gemini' | 'openai';
  label: string;
  note: string;
  /** «≈ 1,20 ₸ за ответ». */
  price: string;
  available: boolean;
};

const FAMILY: Record<ModelOption['provider'], string> = { gemini: 'Google Gemini', openai: 'ChatGPT (OpenAI)' };

/** Выбор ИИ: карточки моделей с примерной ценой ответа. */
export function ModelPicker({ options, current }: { options: ModelOption[]; current: { provider: string; model: string } }) {
  const [selected, setSelected] = useState(current.model);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const choose = (o: ModelOption) => {
    if (!o.available || o.id === selected) return;
    const prev = selected;
    setSelected(o.id);
    setMessage(null);
    start(async () => {
      const r = await saveModelAction(o.provider, o.id);
      if (!r.ok) {
        setSelected(prev);
        setMessage({ ok: false, text: r.error ?? 'Не удалось сохранить' });
      } else {
        setMessage({
          ok: true,
          text: r.reindexed
            ? `Бот теперь отвечает на ${o.label}. База знаний пересчитывается под новый ИИ (${r.reindexed} док.) — минута-две.`
            : `Бот теперь отвечает на ${o.label}.`,
        });
      }
    });
  };

  return (
    <section className="card card-p" style={{ marginBottom: 16 }}>
      <h2 className="card-t">Модель ИИ</h2>
      <p className="small muted" style={{ marginBottom: 14 }}>
        Стоимость списывается с баланса за каждый ответ. Цена — примерная: зависит от длины вопроса и найденных в базе знаний фрагментов.
      </p>
      {message && <div className={`notice ${message.ok ? 'notice-ok' : 'notice-bad'}`}>{message.text}</div>}
      {(['gemini', 'openai'] as const).map((family) => (
        <div key={family} className="model-group">
          <div className="model-family">{FAMILY[family]}</div>
          <div className="model-list">
            {options.filter((o) => o.provider === family).map((o) => (
              <button
                key={o.id}
                type="button"
                className={`model-opt ${selected === o.id ? 'on' : ''}`}
                disabled={!o.available || pending}
                onClick={() => choose(o)}
                aria-pressed={selected === o.id}
              >
                <span className="model-name">{o.label}</span>
                <span className="model-note">{o.available ? o.note : 'Недоступна на платформе'}</span>
                <span className="model-price">{o.price}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
