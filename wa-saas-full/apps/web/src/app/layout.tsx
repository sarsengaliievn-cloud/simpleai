import type { ReactNode } from 'react';
import '../styles/tokens.css';

export const metadata = {
  title: 'Zerde — AI-ассистент для WhatsApp',
  description: 'Ассистент отвечает клиентам в WhatsApp, сложное передаёт менеджеру.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;500;600&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
