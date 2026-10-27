/** Набор иконок панели: тонкая линия 1.6, сетка 20×20, цвет — currentColor. */
const PATHS = {
  chat: 'M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z',
  board: 'M3 3.5h4v13H3zM8.5 3.5h4v9h-4zM14 3.5h3v6h-3z',
  people: 'M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 16.5c.4-2.8 2.4-4.5 5-4.5s4.6 1.7 5 4.5M13 4a2.6 2.6 0 0 1 0 5.2M14.5 12.2c1.6.5 2.7 1.9 3 4.3',
  chart: 'M3 16.5h14M5.5 13.5v-4M9.5 13.5V5.5M13.5 13.5v-6',
  spark: 'M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6L10 2.5ZM15.5 13.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z',
  book: 'M4 3.5h5a2 2 0 0 1 2 2v11a1.5 1.5 0 0 0-1.5-1.5H4zM16 3.5h-3a2 2 0 0 0-2 2v11a1.5 1.5 0 0 1 1.5-1.5H16z',
  flask: 'M8 2.5h4M8.8 2.5v5L4.3 15a1.3 1.3 0 0 0 1.1 2h9.2a1.3 1.3 0 0 0 1.1-2l-4.5-7.5v-5M6.3 12h7.4',
  phone: 'M6.5 2.5h7a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1ZM9 15h2',
  team: 'M10 9a2.8 2.8 0 1 0 0-5.6A2.8 2.8 0 0 0 10 9ZM5 16.5c.4-2.7 2.3-4.3 5-4.3s4.6 1.6 5 4.3M4.5 9.5a2 2 0 1 0 0-4M15.5 9.5a2 2 0 1 0 0-4',
  gear: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
  menu: 'M3 5.5h14M3 10h14M3 14.5h14',
  plus: 'M10 4v12M4 10h12',
  close: 'M5 5l10 10M15 5 5 15',
  arrow: 'M4 10h12M11.5 5.5 16 10l-4.5 4.5',
  bag: 'M4.5 6.5h11l-.8 10H5.3l-.8-10ZM7.5 8V5.5a2.5 2.5 0 0 1 5 0V8',
  user: 'M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 16.5c.5-3 2.6-4.7 5.5-4.7s5 1.7 5.5 4.7',
  x: 'M6 6l8 8M14 6l-8 8',
  wallet: 'M3.5 6.5a2 2 0 0 1 2-2h9v2M3.5 6.5v8a2 2 0 0 0 2 2h11v-10h-11a2 2 0 0 1-2-2ZM13.5 11.5h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden className="ic">
      <path d={PATHS[name]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
