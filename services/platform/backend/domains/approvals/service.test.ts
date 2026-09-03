import { describe, it, expect } from 'vitest';

import { ApprovalError, assertRoleMayDecideKind } from './service';

/**
 * `assertRoleMayDecideKind` is the per-KIND authorization rule on the
 * generic decide door (`POST /api/app/approvals/:id/decide`). The door is
 * an org-member surface, but a GDPR erasure decision is the second half
 * of the dual-control contract the DSR docs promise ("a second Admin must
 * approve"), so the erasure kind demands an org admin for BOTH deciding
 * directions. The DB-backed arc (member refused over HTTP, receipt
 * settled on reject, schedule on approve) runs in the integration check.
 */

describe('assertRoleMayDecideKind', () => {
  it('refuses a plain member deciding an erasure approval', () => {
    expect(() => assertRoleMayDecideKind('erasure', 'member')).toThrowError(
      ApprovalError,
    );
    try {
      assertRoleMayDecideKind('erasure', 'member');
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalError);
      if (error instanceof ApprovalError) {
        expect(error.code).toBe('FORBIDDEN');
        expect(error.status).toBe(403);
      }
    }
  });

  it('refuses the developer role — admin means admin/owner only', () => {
    expect(() => assertRoleMayDecideKind('erasure', 'developer')).toThrowError(
      ApprovalError,
    );
  });

  it('passes admins and owners for the erasure kind', () => {
    expect(() => assertRoleMayDecideKind('erasure', 'admin')).not.toThrow();
    expect(() => assertRoleMayDecideKind('erasure', 'owner')).not.toThrow();
  });

  it('normalizes role case like the membership reader does', () => {
    expect(() => assertRoleMayDecideKind('erasure', 'Admin')).not.toThrow();
    expect(() => assertRoleMayDecideKind('erasure', 'OWNER')).not.toThrow();
  });

  it('leaves every non-erasure kind on the org-member posture', () => {
    for (const kind of [
      'connector_operation',
      'human_input_request',
      'conversations',
      'document_record_review',
      'task_review',
    ]) {
      expect(() => assertRoleMayDecideKind(kind, 'member')).not.toThrow();
    }
  });
});
