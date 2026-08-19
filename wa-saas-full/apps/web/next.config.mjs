import { config } from 'dotenv';

// Next читает .env из своей папки, а у нас он один на монорепо.
// Грузим его до создания конфига, иначе ключи не доедут до сервера.
config({ path: '../../.env' });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Пакеты монорепо компилируются вместе с приложением.
  transpilePackages: ['@wa/db', '@wa/core', '@wa/whatsapp'],
  // Запускаемся как обычный Node-сервер: вебхуки, очереди и долгие
  // AI-вызовы плохо живут с лимитами serverless.
  output: 'standalone',
  webpack: (config) => {
    // Пакеты импортируют друг друга с расширением .js — так требует ESM
    // в Node для воркера. Физически это .ts, и webpack сам не догадается.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
export default nextConfig;
