'use client';

import { useState } from 'react';

/**
 * Столбики по дням: один ряд, одна ось от нуля. Подсказка с датой и числом
 * — при наведении и при фокусе с клавиатуры; под графиком — первый, средний
 * и последний день, без подписи на каждом столбике.
 */
export function DayBars({ data, unit }: { data: Array<{ label: string; value: number }>; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const shown = hover !== null ? data[hover] : null;

  return (
    <div className="daybars">
      <div className="daybars-head">
        <span className="daybars-total">{shown ? shown.value : total}</span>
        <span className="tiny muted">{shown ? `${unit}, ${shown.label}` : `${unit} за период`}</span>
      </div>
      <div className="daybars-plot" onMouseLeave={() => setHover(null)} role="list">
        {data.map((d, i) => (
          <div
            key={i}
            role="listitem"
            tabIndex={0}
            aria-label={`${d.label}: ${d.value}`}
            className={`daybars-col ${hover === i ? 'on' : ''}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <span className="daybars-bar" style={{ height: d.value ? `${Math.max(4, (d.value / max) * 100)}%` : 0 }} />
          </div>
        ))}
      </div>
      <div className="daybars-axis tiny muted">
        <span>{data[0]?.label}</span>
        {data.length > 10 && <span>{data[Math.floor(data.length / 2)]?.label}</span>}
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}
