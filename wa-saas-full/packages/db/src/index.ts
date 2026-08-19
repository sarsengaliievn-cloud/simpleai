export * from '@prisma/client';
export { prisma } from './client.js';
export { forCompany, TENANT_MODELS, TenantScopeError } from './tenant.js';
export type { TenantClient } from './tenant.js';
export { insertChunks, searchChunks, deleteChunks } from './vector.js';
export type { ChunkInput, SearchHit } from './vector.js';
