import { describe, expect, it } from 'vitest';

import type { OrganizationMember } from '../lib/rls/types';
import { assertAuditLogReadAccess } from './queries';

function memberWithRole(role: string): OrganizationMember {
  return {
    _id: 'member_test',
    createdAt: 0,
    organizationId: 'org_test',
    userId: 'user_test',
    role,
  };
}

// #1505: every public audit-log query gates reads through this helper —
// the log records all members' actions, so reads are admin/owner-only.
describe('assertAuditLogReadAccess', () => {
  it.each(['admin', 'owner', 'Admin', 'OWNER'])(
    'allows the %s role',
    (role) => {
      expect(() =>
        assertAuditLogReadAccess(memberWithRole(role)),
      ).not.toThrow();
    },
  );

  it.each(['developer', 'editor', 'member', 'disabled', ''])(
    'rejects the %s role',
    (role) => {
      expect(() => assertAuditLogReadAccess(memberWithRole(role))).toThrow(
        'Only admins can read audit logs',
      );
    },
  );
});
