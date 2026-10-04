import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { setEnqueueBoss } from '../../jobs/enqueue';
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
   * A task review is decided on the task — moving the card is the decision —
   * so the generic door must refuse it without writing anything: a row
   * flipped here would skip the review gate's permission checks and leave
   * the task's own state behind.
   */
  it('refuses a task_review row with 409 and leaves it untouched', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    const sql = fakeSql((text) => {
      if (text.includes('FROM app.approvals')) {
        return [
          {
            resourceType: 'task_review',
            resourceId: '42',
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

/**
 * A pending connector operation parked by a waiting run, and every statement
 * the decision and the run's poke issue answered the way Postgres would. The
 * poke's job goes through the real enqueue façade (`addJobInTx`) to the
 * pg-boss instance the test installs — the final send seam.
 */
function parkedOperation(status = 'pending'): {
  sql: Sql;
  log: { text: string; values: unknown[] }[];
} {
  const log: { text: string; values: unknown[] }[] = [];
  const sql = fakeSql((text) => {
    if (text.includes('FROM app.approvals')) {
      return [
        {
          resourceType: 'connector_operation',
          resourceId: 'run-1:send',
          status,
          metadata: { connector: 'gmail', action: 'send', runId: 'run-1' },
        },
      ];
    }
    if (text.includes('FROM "user"')) {
      return [{ name: 'Dana K.', email: 'dana@example.test' }];
    }
    if (text.includes('FROM app.audit_chain_heads')) {
      return [{ lastHash: '', lastTs: 0 }];
    }
    if (text.includes('INSERT INTO app.audit_logs')) return [{ id: 'audit-1' }];
    if (text.includes('UPDATE app.automation_runs')) return [{ id: 'run-1' }];
    return [];
  }, log);
  return { sql, log };
}

function installBoss(send: (...args: unknown[]) => Promise<unknown>): void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the façade calls `send` alone
  setEnqueueBoss({ send } as unknown as PgBoss);
}

const approve = {
  organizationId: 'org-1',
  approvalId: 'appr-1',
  status: 'executing' as const,
  actor: { userId: 'u-1', role: 'member' },
};

/**
 * The decision commits in its own transaction; waking the parked run comes
 * after it. When that wake failed, the door answered 500 for an approval
 * already recorded (audit row, hint and all), the retry met
 * ALREADY_RESOLVED, and the gate admitted the operation anyway (#3706).
 */
describe('decideApproval — the resume poke after the commit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a committed approval as committed when the resume send fails', async () => {
    const { sql, log } = parkedOperation();
    installBoss(() => Promise.reject(new Error('pg-boss send refused')));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(decideApproval(sql, approve)).resolves.toBeUndefined();

    const texts = log.map((q) => q.text);
    expect(texts.some((t) => t.includes('UPDATE app.approvals SET'))).toBe(
      true,
    );
    expect(texts.some((t) => t.includes('INSERT INTO app.audit_logs'))).toBe(
      true,
    );
    expect(texts.some((t) => t.includes('app_realtime.outbox'))).toBe(true);
    // The wake was attempted after the decision, not skipped.
    const decidedAt = texts.findIndex((t) => t.includes('app_realtime.outbox'));
    const wokenAt = texts.findIndex((t) =>
      t.includes('UPDATE app.automation_runs'),
    );
    expect(wokenAt).toBeGreaterThan(decidedAt);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('approval appr-1 is decided'),
      expect.objectContaining({ message: 'pg-boss send refused' }),
    );
  });

  it('enqueues exactly one step for the run a normal decision wakes', async () => {
    const { sql } = parkedOperation();
    const send = vi.fn().mockResolvedValue('job-1');
    installBoss(send);

    await decideApproval(sql, { ...approve, status: 'rejected' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'automation.step',
      { organizationId: 'org-1', runId: 'run-1' },
      expect.objectContaining({ db: expect.any(Object) }),
    );
  });

  it('still refuses a decided approval and wakes nothing', async () => {
    const { sql, log } = parkedOperation('executing');
    const send = vi.fn().mockResolvedValue('job-1');
    installBoss(send);

    const outcome = await decideApproval(sql, approve).then(
      () => null,
      (err: unknown) => err,
    );

    expect(outcome).toBeInstanceOf(ApprovalError);
    if (outcome instanceof ApprovalError) {
      expect(outcome.code).toBe('ALREADY_RESOLVED');
      expect(outcome.status).toBe(409);
    }
    expect(send).not.toHaveBeenCalled();
    expect(log.some((q) => q.text.includes('UPDATE app.automation_runs'))).toBe(
      false,
    );
  });
});
