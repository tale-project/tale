import { describe, expect, it } from 'vitest';

import { authorizeRls } from './access.ts';
import { isAdminRole } from './membership.ts';

/**
 * The Better Auth role matrix must agree with the ported RLS matrix in
 * `core/lib/rls/helpers/access_control.ts` (which has its own suite) on the
 * rows where the two overlap. `auditLogs` is the row that drifted: the port
 * derived every role from `uniformGrants`, which handed `member`, `editor`
 * and `developer` a read they must not have.
 */
describe('authorizeRls — auditLogs (#1505 read-side hardening)', () => {
  it('grants read only to admin and owner', () => {
    expect(authorizeRls('owner', 'auditLogs', 'read')).toBe(true);
    expect(authorizeRls('admin', 'auditLogs', 'read')).toBe(true);
    expect(authorizeRls('developer', 'auditLogs', 'read')).toBe(false);
    expect(authorizeRls('editor', 'auditLogs', 'read')).toBe(false);
    expect(authorizeRls('member', 'auditLogs', 'read')).toBe(false);
    expect(authorizeRls('disabled', 'auditLogs', 'read')).toBe(false);
  });

  it('keeps write for every role whose own actions are audited', () => {
    expect(authorizeRls('owner', 'auditLogs', 'write')).toBe(true);
    expect(authorizeRls('admin', 'auditLogs', 'write')).toBe(true);
    expect(authorizeRls('developer', 'auditLogs', 'write')).toBe(true);
    expect(authorizeRls('editor', 'auditLogs', 'write')).toBe(true);
    expect(authorizeRls('member', 'auditLogs', 'write')).toBe(false);
    expect(authorizeRls('disabled', 'auditLogs', 'write')).toBe(false);
  });

  it('agrees with the isAdminRole gate the audit-log doors use', () => {
    for (const role of ['owner', 'admin', 'developer', 'editor', 'member']) {
      expect(authorizeRls(role, 'auditLogs', 'read')).toBe(isAdminRole(role));
    }
  });
});

/**
 * The conversation WRITE gate reads the same matrix. 0.4 gave
 * `conversations` / `conversationMessages` ALL to editor-and-above and
 * READ_ONLY to `member`, so a read-only member can see a thread assigned to
 * them but never change one.
 */
describe('authorizeRls — conversations write is editor-or-above', () => {
  it.each(['conversations', 'conversationMessages'] as const)(
    'gates %s writes on an editor-or-above role',
    (table) => {
      expect(authorizeRls('owner', table, 'write')).toBe(true);
      expect(authorizeRls('admin', table, 'write')).toBe(true);
      expect(authorizeRls('developer', table, 'write')).toBe(true);
      expect(authorizeRls('editor', table, 'write')).toBe(true);
      expect(authorizeRls('member', table, 'write')).toBe(false);
      expect(authorizeRls('disabled', table, 'write')).toBe(false);
    },
  );

  it.each(['conversations', 'conversationMessages'] as const)(
    'leaves %s reads open to every active role',
    (table) => {
      expect(authorizeRls('editor', table, 'read')).toBe(true);
      expect(authorizeRls('member', table, 'read')).toBe(true);
      expect(authorizeRls('disabled', table, 'read')).toBe(false);
    },
  );
});
