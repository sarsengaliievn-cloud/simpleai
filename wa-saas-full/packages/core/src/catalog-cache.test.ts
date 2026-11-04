import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { loadCatalog, clearCatalogCache } from './catalog.js';

const body = readFileSync(new URL('./__fixtures__/catalog.json', import.meta.url));
let delay = 0;
let hits = 0;
let server: http.Server;
let url = '';

beforeAll(async () => {
  process.env.CATALOG_ALLOW_PRIVATE = '1';
  server = http.createServer((_req, res) => {
    hits += 1;
    setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(body); }, delay);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/publicCatalog`;
});
afterAll(() => { server.close(); delete process.env.CATALOG_ALLOW_PRIVATE; });

describe('кэш каталога', () => {
  it('второй запрос в течение 5 минут склад не дёргает', async () => {
    clearCatalogCache();
    hits = 0;
    await loadCatalog({ url });
    await loadCatalog({ url });
    expect(hits).toBe(1);
  });
  it('одновременные запросы — один поход на склад', async () => {
    clearCatalogCache();
    hits = 0;
    delay = 200;
    await Promise.all([loadCatalog({ url }), loadCatalog({ url }), loadCatalog({ url })]);
    expect(hits).toBe(1);
    delay = 0;
  });
});
