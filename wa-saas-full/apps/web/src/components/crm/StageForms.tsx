'use client';

import { useState } from 'react';

export const LOST_REASONS = ['Дорого', 'Нет размера или модели', 'Купил в другом месте', 'Не отвечает', 'Передумал'];

/** Новый заказ: сумма и товар обязательны — без них не посчитать выручку. */
export function OrderForm({
  initial,
  pending,
  onSubmit,
  onCancel,
  submitLabel = 'Оформить заказ',
}: {
  initial?: { amount?: number | null; product?: string | null; comment?: string | null };
  pending?: boolean;
  onSubmit: (v: { amount: string; product: string; comment: string }) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '');
  const [product, setProduct] = useState(initial?.product ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');

  return (
    <form
      className="stage-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ amount, product, comment });
      }}
    >
      <label className="field">
        <span className="label">Сумма, ₸</span>
        <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25 000" required autoFocus />
      </label>
      <label className="field">
        <span className="label">Товар</span>
        <input className="input" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Модель, размер, цвет" required />
      </label>
      <label className="field">
        <span className="label">Комментарий</span>
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Доставка, оплата — по желанию" />
      </label>
      <div className="row">
        <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>{pending ? 'Сохраняю…' : submitLabel}</button>
        <button className="btn btn-quiet btn-sm" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}

/** Отказ: причина нужна, чтобы потом видеть, на чём теряются клиенты. */
export function LostForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending?: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="stage-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason);
      }}
    >
      <span className="label">Почему отказался</span>
      <div className="reason-chips">
        {LOST_REASONS.map((r) => (
          <button key={r} type="button" className={`chip chip-btn ${reason === r ? 'chip-on' : ''}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Или своими словами" style={{ marginBottom: 12 }} />
      <div className="row">
        <button className="btn btn-danger btn-sm" type="submit" disabled={pending || !reason.trim()}>{pending ? 'Сохраняю…' : 'Отметить отказ'}</button>
        <button className="btn btn-quiet btn-sm" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}
