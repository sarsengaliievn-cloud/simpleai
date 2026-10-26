'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Тихо перезапрашивает страницу, пока `active` истинно. Используется там,
 * где работа идёт в воркере (индексация документов) и статус меняется
 * без участия пользователя.
 */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);

  return null;
}
