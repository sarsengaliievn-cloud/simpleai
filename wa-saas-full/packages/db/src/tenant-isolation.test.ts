import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from './client.js';
import { forCompany, TENANT_MODELS, TenantScopeError } from './tenant.js';

/**
 * Главный тест безопасности проекта. Если он падает — не деплоим.
 * Требует поднятой локальной БД: docker compose up -d.
 */

let companyA: string;
let companyB: string;

beforeAll(async () => {
  const a = await prisma.company.create({
    data: { name: 'Company A', slug: `a-${Date.now()}` },
  });
  const b = await prisma.company.create({
    data: { name: 'Company B', slug: `b-${Date.now()}` },
  });
  companyA = a.id;
  companyB = b.id;

  await prisma.customer.createMany({
    data: [
      { companyId: companyA, waId: '77010000001', phone: '+77010000001', name: 'Клиент A' },
      { companyId: companyB, waId: '77010000002', phone: '+77010000002', name: 'Клиент B' },
    ],
  });
});

afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('изоляция арендаторов', () => {
  it('findMany возвращает только записи своей компании', async () => {
    const db = forCompany(prisma, companyA);
    const customers = await db.customer.findMany();
    expect(customers).toHaveLength(1);
    expect(customers[0]?.name).toBe('Клиент A');
  });

  it('нельзя достать чужую запись по её id', async () => {
    const foreign = await prisma.customer.findFirstOrThrow({ where: { companyId: companyB } });
    const db = forCompany(prisma, companyA);
    const found = await db.customer.findFirst({ where: { id: foreign.id } });
    expect(found).toBeNull();
  });

  it('чужую запись нельзя изменить', async () => {
    const foreign = await prisma.customer.findFirstOrThrow({ where: { companyId: companyB } });
    const db = forCompany(prisma, companyA);
    const result = await db.customer.updateMany({
      where: { id: foreign.id },
      data: { name: 'Взломано' },
    });
    expect(result.count).toBe(0);
  });

  it('чужую запись нельзя удалить', async () => {
    const foreign = await prisma.customer.findFirstOrThrow({ where: { companyId: companyB } });
    const db = forCompany(prisma, companyA);
    const result = await db.customer.deleteMany({ where: { id: foreign.id } });
    expect(result.count).toBe(0);
  });

  it('create проставляет companyId сам, даже если передали чужой', async () => {
    const db = forCompany(prisma, companyA);
    const created = await db.customer.create({
      data: {
        companyId: companyB,
        waId: `7701${Date.now()}`.slice(0, 11),
        phone: '+77010000003',
      } as never,
    });
    expect(created.companyId).toBe(companyA);
  });

  it('findUnique для моделей арендатора запрещён', async () => {
    const db = forCompany(prisma, companyA);
    await expect(db.customer.findUnique({ where: { id: companyA } })).rejects.toBeInstanceOf(
      TenantScopeError,
    );
  });

  it('список TENANT_MODELS не отстал от схемы', () => {
    // Сознательные исключения: пишутся до того, как компания определена.
    const GLOBAL_BY_DESIGN = new Set(['WebhookEvent']);

    const modelsWithCompanyId = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'companyId'))
      .map((m) => m.name)
      .filter((name) => !GLOBAL_BY_DESIGN.has(name));

    const missing = modelsWithCompanyId.filter((name) => !TENANT_MODELS.has(name));
    expect(missing, `модели без tenant-фильтра: ${missing.join(', ')}`).toEqual([]);
  });
});
