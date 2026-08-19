import { Role } from '@wa/db';

export const PERMISSIONS = [
  'conversations:read',
  'conversations:write',
  'customers:read',
  'customers:write',
  'whatsapp:manage',
  'ai:manage',
  'knowledge:manage',
  'team:manage',
  'billing:manage',
  'analytics:read',
  'settings:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: Permission[] = [
  'conversations:read',
  'conversations:write',
  'customers:read',
  'customers:write',
  'analytics:read',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: PERMISSIONS.filter((p) => p !== 'billing:manage'),
  MANAGER,
  OPERATOR: ['conversations:read', 'conversations:write', 'customers:read'],
  ANALYST: ['conversations:read', 'customers:read', 'analytics:read'],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
