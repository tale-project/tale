import { describe, expect, it } from 'vitest';

import { authorizeRls } from './access.ts';

/**
 * The LIVE Better Auth access matrix (`auth/access.ts`) is what every HTTP
 * route consults through `authorizeRls`. These tests pin the security-relevant
 * grants — chiefly that audit-log READS are admin-only (0.4 #1505/#1852),
 * which the 0.5 `uniformGrants(['read'])` default had regressed to every active
 * role. They mirror the retained RLS matrix's own test
 * (core/lib/rls/helpers/access_control.test.ts) so the two matrices can never
 * silently diverge again.
 */

describe('auth/access authorizeRls — audit-log read gate (#1505/#1852)', () => {
  it('grants audit-log READ only to owner and admin', () => {
    expect(authorizeRls('owner', 'auditLogs', 'read')).toBe(true);
    expect(authorizeRls('admin', 'auditLogs', 'read')).toBe(true);
    expect(authorizeRls('developer', 'auditLogs', 'read')).toBe(false);
    expect(authorizeRls('editor', 'auditLogs', 'read')).toBe(false);
    expect(authorizeRls('member', 'auditLogs', 'read')).toBe(false);
    expect(authorizeRls('disabled', 'auditLogs', 'read')).toBe(false);
  });

  it('normalizes case + undefined without leaking audit reads', () => {
    expect(authorizeRls('Admin', 'auditLogs', 'read')).toBe(true);
    expect(authorizeRls('Owner', 'auditLogs', 'read')).toBe(true);
    expect(authorizeRls('MEMBER', 'auditLogs', 'read')).toBe(false);
    // Unknown / undefined roles degrade to member — must NOT read audit logs.
    expect(authorizeRls('superadmin', 'auditLogs', 'read')).toBe(false);
    expect(authorizeRls(undefined, 'auditLogs', 'read')).toBe(false);
  });

  it('keeps audit WRITE for roles whose mutations insert their own rows', () => {
    // Write is unrelated to the read regression; developer/editor keep it so
    // RLS-wrapped user mutations can still audit themselves. Member never had
    // it; disabled has nothing.
    expect(authorizeRls('owner', 'auditLogs', 'write')).toBe(true);
    expect(authorizeRls('admin', 'auditLogs', 'write')).toBe(true);
    expect(authorizeRls('developer', 'auditLogs', 'write')).toBe(true);
    expect(authorizeRls('editor', 'auditLogs', 'write')).toBe(true);
    expect(authorizeRls('member', 'auditLogs', 'write')).toBe(false);
    expect(authorizeRls('disabled', 'auditLogs', 'write')).toBe(false);
  });
});

describe('auth/access authorizeRls — content grants unchanged', () => {
  it('keeps the ordinary content-table read/write ladder intact', () => {
    // Guard that the audit override did not disturb the rest of the matrix.
    expect(authorizeRls('member', 'documents', 'read')).toBe(true);
    expect(authorizeRls('member', 'documents', 'write')).toBe(false);
    expect(authorizeRls('editor', 'documents', 'write')).toBe(true);
    expect(authorizeRls('editor', 'connectors', 'write')).toBe(false);
    expect(authorizeRls('developer', 'documents', 'write')).toBe(true);
    expect(authorizeRls('disabled', 'documents', 'read')).toBe(false);
  });
});
