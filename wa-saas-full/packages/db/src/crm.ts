/**
 * Этапы воронки, с которыми компания начинает. Названия можно поменять,
 * свои этапы «в работе» — добавить. Роли NEW / ORDER / WON / LOST есть
 * всегда ровно по одной: по ним считается конверсия.
 */
export const DEFAULT_STAGES = [
  { name: 'Новый', kind: 'NEW', position: 0 },
  { name: 'У менеджера', kind: 'WORK', position: 1 },
  { name: 'Думает', kind: 'WORK', position: 2 },
  { name: 'Новый заказ', kind: 'ORDER', position: 3 },
  { name: 'Выдан', kind: 'WON', position: 4 },
  { name: 'Отказ', kind: 'LOST', position: 5 },
] as const;
