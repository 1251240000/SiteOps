import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
  can,
  type Permission,
  type UserRole,
} from '../constants/users.js';

describe('permissions matrix', () => {
  it('exposes all four CRUD-style verbs for representative resources', () => {
    expect(PERMISSIONS).toContain('users.read');
    expect(PERMISSIONS).toContain('users.write');
    expect(PERMISSIONS).toContain('sites.read');
    expect(PERMISSIONS).toContain('sites.write');
  });

  it('admin holds every permission key (wildcard)', () => {
    for (const key of PERMISSIONS) {
      expect(can('admin', key)).toBe(true);
    }
  });

  it('viewer has zero write permissions', () => {
    for (const key of PERMISSIONS) {
      if (key.endsWith('.write')) {
        expect(can('viewer', key)).toBe(false);
      }
    }
  });

  it('viewer can read most resources', () => {
    expect(can('viewer', 'sites.read')).toBe(true);
    expect(can('viewer', 'errors.read')).toBe(true);
    expect(can('viewer', 'metrics.read')).toBe(true);
  });

  it('viewer cannot read team or api keys (admin-only surfaces)', () => {
    expect(can('viewer', 'users.read')).toBe(false);
    expect(can('viewer', 'api_keys.read')).toBe(false);
  });

  it('operator can write content/ops resources but not team/api keys', () => {
    expect(can('operator', 'sites.write')).toBe(true);
    expect(can('operator', 'tasks.write')).toBe(true);
    expect(can('operator', 'alerts.write')).toBe(true);
    expect(can('operator', 'errors.write')).toBe(true);
    expect(can('operator', 'integrations.write')).toBe(true);

    expect(can('operator', 'users.write')).toBe(false);
    expect(can('operator', 'users.read')).toBe(false);
    expect(can('operator', 'api_keys.write')).toBe(false);
    expect(can('operator', 'api_keys.read')).toBe(false);
  });

  it('only admin can manage team and api keys', () => {
    const adminOnly: Permission[] = [
      'users.read',
      'users.write',
      'api_keys.read',
      'api_keys.write',
    ];
    for (const key of adminOnly) {
      expect(can('admin', key)).toBe(true);
      expect(can('operator', key)).toBe(false);
      expect(can('viewer', key)).toBe(false);
    }
  });

  it('matrix has explicit entries for every permission on non-admin roles', () => {
    // Defends against silently-default-allowed perms when the list is extended.
    for (const role of USER_ROLES) {
      if (role === 'admin') continue;
      const map = ROLE_PERMISSIONS[role];
      for (const key of PERMISSIONS) {
        expect(typeof map[key]).toBe('boolean');
      }
    }
  });

  it('can() returns false for unknown permission keys on non-admin roles', () => {
    // admin has the `'*'` wildcard so unknown keys still return true — that's
    // intentional (admin = full access). Non-admin roles must be deny-by-default.
    expect(can('admin', 'made.up' as unknown as Permission)).toBe(true);
    expect(can('viewer', 'made.up' as unknown as Permission)).toBe(false);
    expect(can('operator', 'made.up' as unknown as Permission)).toBe(false);
  });

  it('can() returns false for unknown role without throwing', () => {
    expect(can('superadmin' as unknown as UserRole, 'sites.read')).toBe(false);
  });
});
