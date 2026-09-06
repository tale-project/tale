import type { Sql } from 'postgres';
import { describe, it, expect } from 'vitest';

import {
  ApprovalError,
  assertRoleMayDecideKind,
  decideApproval,
} from './service';

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

/** A `sql` stand-in dispatching on the query text; `begin` runs the callback
 * against the same stand-in so every statement of the decision is logged. */
function fakeSql(
  answer: (text: string, values: unknown[]) => unknown[],
  log: { text: string; values: unknown[] }[],
): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const api = {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  };
  const sql = Object.assign(tag, api);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

describe('decideApproval — kinds with a dedicated settle path are refused', () => {
  /**
   * A chat question lives on `app.approvals` as a `human_input_request` row
   * and is settled by the person's next message in the thread; every reader
   * in `chat/questions.ts` matches `status = 'pending'`. The generic door
   * refused review-gate rows but let this kind through, so an authenticated
   * `POST /approvals/:id/decide` flipped the row to `executing` — a state no
   * consumer reads — and stranded the thread's question.
   */
  it('refuses a human_input_request row with 409 and leaves it untouched', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    const sql = fakeSql((text) => {
      if (text.includes('FROM app.approvals')) {
        return [
          {
            resourceType: 'human_input_request',
            resourceId: 'thr-1',
            status: 'pending',
            metadata: null,
          },
        ];
      }
      return [];
    }, log);

    const outcome = await decideApproval(sql, {
      organizationId: 'org-1',
      approvalId: 'appr-1',
      status: 'executing',
      actor: { userId: 'u-1', role: 'member' },
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(outcome).toBeInstanceOf(ApprovalError);
    if (outcome instanceof ApprovalError) {
      expect(outcome.code).toBe('APPROVAL_REQUIRES_DEDICATED_RESPOND');
      expect(outcome.status).toBe(409);
    }
    expect(log.some((q) => q.text.includes('UPDATE app.approvals'))).toBe(
      false,
    );
    expect(log.some((q) => q.text.includes('INSERT INTO app.audit_logs'))).toBe(
      false,
    );
  });

  it('still refuses the two review-gate kinds the same way', async () => {
    for (const kind of ['document_record_review', 'task_review']) {
      const log: { text: string; values: unknown[] }[] = [];
      const sql = fakeSql(
        () => [
          {
            resourceType: kind,
            resourceId: 'r-1',
            status: 'pending',
            metadata: null,
          },
        ],
        log,
      );
      const outcome = await decideApproval(sql, {
        organizationId: 'org-1',
        approvalId: 'appr-1',
        status: 'rejected',
        actor: { userId: 'u-1', role: 'admin' },
      }).then(
        () => null,
        (err: unknown) => err,
      );
      expect(outcome instanceof ApprovalError && outcome.status === 409).toBe(
        true,
      );
    }
  });
});
