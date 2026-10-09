// @vitest-environment node

/**
 * The erasure receipt's lifecycle transitions over a recording fake of the
 * postgres.js tag: what each door WRITES (the statements and their values)
 * and what it hands to the job queue, the audit chain and the realtime
 * outbox. The full cascade over a real database runs in the integration
 * check; these pin the transitions that used to be silent or unguarded —
 * the Retry of a receipt blocked at filing (policy re-applied, CAS re-arm),
 * the execution-time hold block (audited), the limiter outage (not a
 * denial), the project-agent-runs pass, the model-endpoint requests pass
 * (settled rows deleted, rows in flight pseudonymised), and the review pass
 * handing a waiting review on instead of stamping it with the pseudonym.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  checkOrganizationRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { loadActiveHolds } from '../legal_holds/service.ts';
import { writeNotificationForOrgs } from '../notifications/service.ts';
import { TaskError } from '../tasks/errors.ts';
import { retargetPendingTaskReview } from '../tasks/reviews.ts';
import { loadTaskOrThrow, type TaskRow } from '../tasks/service.ts';
import {
  ErasureError,
  getErasureRequest,
  processErasure,
  requestErasure,
  retryErasure,
} from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job-1')),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(() => Promise.resolve(null)),
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/rate-limit.ts')>();
  return { ...actual, checkOrganizationRateLimit: vi.fn() };
});
vi.mock('../../lib/object-store.ts', () => ({
  resolveObjectStore: vi.fn(),
  s3DeleteObject: vi.fn(),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve('audit-1')),
}));
vi.mock('../governance/settings-tail.ts', () => ({
  applyMaturedDsarPolicyChange: vi.fn(),
}));
vi.mock('../legal_holds/service.ts', () => ({ loadActiveHolds: vi.fn() }));
vi.mock('../notifications/service.ts', () => ({
  writeNotificationForOrgs: vi.fn(),
}));
vi.mock('../retention/service.ts', () => ({
  purgeThreadLineage: vi.fn(() => Promise.resolve(0)),
  purgeDocument: vi.fn(),
}));
vi.mock('../tasks/reviews.ts', () => ({ retargetPendingTaskReview: vi.fn() }));
vi.mock('../tasks/service.ts', () => ({ loadTaskOrThrow: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * A recorder for the postgres.js tag: every statement lands in
 * `statements` (whitespace collapsed, values in order); `answer` scripts
 * the rows a statement gets back, everything else answers no rows.
 * `begin` runs the callback on the same recorder, so the transaction's
 * statements are recorded in order with the rest.
 */
function fakeSql(
  answer: (text: string, values: unknown[]) => unknown[] | undefined,
): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    strings.forEach((part, index) => {
      text += part;
      if (index < values.length) text += '?';
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text, values) ?? []);
  };
  tag.begin = (
    optionsOrCallback: string | ((tx: typeof tag) => unknown),
    callback?: (tx: typeof tag) => unknown,
  ): unknown => {
    if (typeof optionsOrCallback === 'string') {
      statements.push({ text: `BEGIN ${optionsOrCallback}`, values: [] });
      return callback?.(tag);
    }
    return optionsOrCallback(tag);
  };
  tag.json = (value: unknown): unknown => value;
  return { sql: tag as unknown as Sql, statements };
}

const noHolds = { orgHeld: false, userMembershipIds: new Set<string>() };

function receiptRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    targetUserId: 'subject',
    error: null,
    status: 'blocked',
    effectiveAt: null,
    requestedBy: 'filer',
    reason: 'Consent withdrawn',
    reasonCode: 'consent_withdrawn',
    threadsTargeted: 2,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('retryErasure', () => {
  it('parks a receipt blocked at filing for the second admin under dual approval — no processor enqueued [ERASE-R3]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      requireDualApproval: true,
      coolingOffHours: 24,
    } as never);
    const fake = fakeSql((text) => {
      if (text.startsWith('SELECT target_user_id')) return [receiptRow()];
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'pending'",
        )
      )
        return [{ id: 'req-1' }];
      return undefined;
    });

    await retryErasure(fake.sql, {
      organizationId: 'org_1',
      requestId: 'req-1',
      actor: { userId: 'admin-2' },
    });

    expect(addJobInTx).not.toHaveBeenCalled();
    const approval = fake.statements.find((s) =>
      s.text.startsWith('INSERT INTO app.approvals'),
    );
    expect(approval?.values.slice(0, 2)).toEqual(['org_1', 'req-1']);
    expect(approval?.values[2]).toMatchObject({
      subjectUserId: 'subject',
      requestedBy: 'filer',
      reasonCode: 'consent_withdrawn',
      threadsTargetedCount: 2,
    });
    expect(writeNotificationForOrgs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ titleKey: 'dsarApprovalNeeded' }),
    );
    const rearm = fake.statements.find((s) =>
      s.text.startsWith(
        "UPDATE app.gdpr_erasure_requests SET status = 'pending'",
      ),
    );
    // Parked: no schedule stamp until the approver confirms.
    expect(rearm?.values).toEqual([null, 'req-1', 'org_1']);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'gdpr_erasure_retried',
        newState: expect.objectContaining({ awaitingApproval: true }),
      }),
    );
    expect(emitHintInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity: 'gdpr_erasure', entityId: 'req-1' }),
    );
  });

  it('re-schedules a receipt blocked at filing behind the cooling-off window [ERASE-R3]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      requireDualApproval: false,
      coolingOffHours: 24,
    } as never);
    const before = Date.now();
    const fake = fakeSql((text) => {
      if (text.startsWith('SELECT target_user_id')) return [receiptRow()];
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'pending'",
        )
      )
        return [{ id: 'req-1' }];
      return undefined;
    });

    await retryErasure(fake.sql, {
      organizationId: 'org_1',
      requestId: 'req-1',
    });

    const rearm = fake.statements.find((s) =>
      s.text.startsWith(
        "UPDATE app.gdpr_erasure_requests SET status = 'pending'",
      ),
    );
    const effectiveAt = rearm?.values[0];
    expect(typeof effectiveAt).toBe('number');
    expect(effectiveAt as number).toBeGreaterThanOrEqual(
      before + 24 * 3_600_000,
    );
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    const options = vi.mocked(addJobInTx).mock.calls[0]?.[3];
    expect(options?.startAfter).toEqual(new Date(effectiveAt as number));
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('INSERT INTO app.approvals'),
      ),
    ).toBe(false);
  });

  it('re-runs a partial receipt immediately without re-reading the policy [ERASE-R4]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (text.startsWith('SELECT target_user_id'))
        return [receiptRow({ status: 'partial', effectiveAt: 1_000 })];
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'pending'",
        )
      )
        return [{ id: 'req-1' }];
      return undefined;
    });

    await retryErasure(fake.sql, {
      organizationId: 'org_1',
      requestId: 'req-1',
    });

    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'governance.process_erasure',
      { requestId: 'req-1' },
      {},
    );
  });

  it('keeps the fast re-run for a receipt blocked at execution time (schedule stamp present) [ERASE-R4]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (text.startsWith('SELECT target_user_id'))
        return [receiptRow({ status: 'blocked', effectiveAt: 1_000 })];
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'pending'",
        )
      )
        return [{ id: 'req-1' }];
      return undefined;
    });

    await retryErasure(fake.sql, {
      organizationId: 'org_1',
      requestId: 'req-1',
    });

    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  it('re-arms with a status compare-and-set — a receipt that settled meanwhile is not enqueued [ERASE-R4]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (text.startsWith('SELECT target_user_id'))
        return [receiptRow({ status: 'partial', effectiveAt: 1_000 })];
      return undefined; // the CAS finds no retriable row any more
    });

    await expect(
      retryErasure(fake.sql, { organizationId: 'org_1', requestId: 'req-1' }),
    ).rejects.toMatchObject({ code: 'NOT_RETRIABLE', status: 409 });

    const rearm = fake.statements.find((s) =>
      s.text.startsWith(
        "UPDATE app.gdpr_erasure_requests SET status = 'pending'",
      ),
    );
    expect(rearm?.text).toContain(
      "WHERE id = ? AND org_id = ? AND status IN ('blocked', 'partial', 'failed') RETURNING id",
    );
    // A re-armed receipt starts clean: the recorded stop reason (a hold
    // token or the failed passes) must not follow it into `pending`.
    expect(rearm?.text).toContain('error = NULL');
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('processErasure', () => {
  it('audits and hints an execution-time hold block, and clears the start stamp [ERASE-R1]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue({
      orgHeld: false,
      userMembershipIds: new Set(['subject']),
    });
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      return undefined;
    });

    await processErasure(fake.sql, 'req-1');

    const blocked = fake.statements.find((s) =>
      s.text.startsWith(
        "UPDATE app.gdpr_erasure_requests SET status = 'blocked'",
      ),
    );
    expect(blocked?.text).toContain('started_at_ms = NULL');
    // The receipt records WHICH hold stopped it, so the drawer's panel can
    // name it instead of the generic line.
    expect(blocked?.text).toContain('error = ?');
    expect(blocked?.values).toEqual(['user_custodian_hold', 'req-1']);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'gdpr_erasure_blocked_by_hold',
        actorType: 'system',
        resourceId: 'subject',
        newState: expect.objectContaining({
          requestId: 'req-1',
          userCustodianHeld: true,
          atExecution: true,
        }),
      }),
    );
    expect(emitHintInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity: 'gdpr_erasure', entityId: 'req-1' }),
    );
    // No cascade pass ran.
    expect(fake.statements.some((s) => s.text.includes('DELETE FROM'))).toBe(
      false,
    );
  });

  it('pseudonymises the project-agent runs the subject started and counts the pass on the receipt [ERASE-R5]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      if (text.startsWith('UPDATE app.project_agent_runs'))
        return [{ id: 'run-1' }, { id: 'run-2' }];
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });

    await processErasure(fake.sql, 'req-1');

    const runs = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.project_agent_runs'),
    );
    expect(runs?.text).toBe(
      'UPDATE app.project_agent_runs SET started_by = ?, feedback = NULL WHERE org_id = ? AND started_by = ? RETURNING id',
    );
    expect(runs?.values).toEqual(['erased-user', 'org_1', 'subject']);
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[0]).toBe('done');
    expect(settle?.values[2]).toMatchObject({ agentRuns: 2 });
  });

  /**
   * Automation runs carry every node's resolved values, so the subject's
   * runs go — under all three starter markers. The bare user id is the one
   * the builder session and the chat capability recorded before the engine
   * store prefixed its starter; the pass used to match only the two
   * prefixed forms and left those runs behind.
   */
  it('deletes the automation runs the subject started under every starter marker [ERASE-R5]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      if (text.startsWith('DELETE FROM app.automation_runs'))
        return [{ id: 'run-1' }, { id: 'run-2' }, { id: 'run-3' }];
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });

    await processErasure(fake.sql, 'req-1');

    const runs = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.automation_runs'),
    );
    expect(runs?.text).toBe(
      'DELETE FROM app.automation_runs WHERE org_id = ? AND started_by = ANY(?) AND legacy_quarantine IS NULL RETURNING id',
    );
    expect(runs?.values).toEqual([
      'org_1',
      ['user:subject', 'api-key:subject', 'subject'],
    ]);
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[2]).toMatchObject({ automationRuns: 3 });
  });

  it("deletes the subject's coding-agent call counters in the organization", async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      if (text.startsWith('DELETE FROM app.mcp_client_activity'))
        return [{ day: 20261007 }, { day: 20261008 }];
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });

    await processErasure(fake.sql, 'req-1');

    const removed = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.mcp_client_activity'),
    );
    expect(removed?.text).toBe(
      'DELETE FROM app.mcp_client_activity WHERE org_id = ? AND user_id = ? RETURNING day',
    );
    expect(removed?.values).toEqual(['org_1', 'subject']);
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[2]).toMatchObject({ mcpActivity: 2 });
  });

  it('deletes unheld runs while preserving and reporting legacy-held subject runs [ERASE-R9]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text, values) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      if (
        text.includes('FROM app.automation_runs') &&
        text.startsWith('SELECT')
      ) {
        expect(text).toContain('legacy_quarantine IS NOT NULL');
        expect(values).toEqual([
          'org_1',
          ['user:subject', 'api-key:subject', 'subject'],
        ]);
        return [{ count: 1 }];
      }
      if (text.startsWith('DELETE FROM app.automation_runs')) {
        if (!text.includes('legacy_quarantine IS NULL'))
          throw Object.assign(new Error('held run cannot be deleted'), {
            code: 'P7502',
          });
        expect(values).toEqual([
          'org_1',
          ['user:subject', 'api-key:subject', 'subject'],
        ]);
        return [{ id: 'unheld-run' }];
      }
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });
    await processErasure(fake.sql, 'req-1');
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[0]).toBe('partial');
    expect(settle?.values[2]).toMatchObject({
      automationRuns: { rows: 1, skippedByHold: 1 },
    });
    expect(settle?.values[3]).toBe('legacy_automation_hold');
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('UPDATE app.project_agent_runs'),
      ),
    ).toBe(true);
    expect(
      fake.statements.some((s) =>
        s.text.includes('automation_legacy_stop_run'),
      ),
    ).toBe(false);
  });

  /**
   * A request through the model endpoints for API keys is an op row stamped
   * with the key holder. One whose spend is booked and whose key is deleted
   * (or never minted) goes; one still in flight keeps its hold and its key
   * for the settlement — deleting it would orphan the key and drop the spend
   * from the organization's usage — and loses the identity instead.
   */
  it('deletes settled model API and direct automation requests and pseudonymises the ones in flight [ERASE-R5]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      if (text.startsWith('DELETE FROM app.sandbox_session_ops'))
        return [{ id: 'op-settled-1' }, { id: 'op-settled-2' }];
      if (text.startsWith('UPDATE app.sandbox_session_ops'))
        return [{ id: 'op-in-flight' }];
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });

    await processErasure(fake.sql, 'req-1');

    const indexOf = (prefix: string) =>
      fake.statements.findIndex((s) => s.text.startsWith(prefix));
    const removed =
      fake.statements[indexOf('DELETE FROM app.sandbox_session_ops')];
    expect(removed?.text).toBe(
      'DELETE FROM app.sandbox_session_ops WHERE org_id = ? AND kind = ANY(?) AND user_id = ? AND spend_settled_at_ms IS NOT NULL AND (key_revoked_at_ms IS NOT NULL OR minted_key_id IS NULL) RETURNING id',
    );
    expect(removed?.values).toEqual([
      'org_1',
      ['model-api', 'automation-llm'],
      'subject',
    ]);
    const pseudonymised =
      fake.statements[indexOf('UPDATE app.sandbox_session_ops')];
    // Every row of the subject the delete left — no settlement predicate, so
    // a row that settled in between cannot keep the subject's id.
    expect(pseudonymised?.text).toBe(
      'UPDATE app.sandbox_session_ops SET user_id = ? WHERE org_id = ? AND kind = ANY(?) AND user_id = ? RETURNING id',
    );
    expect(pseudonymised?.values).toEqual([
      'erased-user',
      'org_1',
      ['model-api', 'automation-llm'],
      'subject',
    ]);
    expect(indexOf('DELETE FROM app.sandbox_session_ops')).toBeGreaterThan(
      indexOf('DELETE FROM app.automation_runs'),
    );
    // The delete first, then the pseudonym — both before the ledger pass,
    // so a request settling mid-cascade books either before the ledger is
    // cleared or under the pseudonym, never under the subject afterwards.
    expect(indexOf('UPDATE app.sandbox_session_ops')).toBeGreaterThan(
      indexOf('DELETE FROM app.sandbox_session_ops'),
    );
    expect(indexOf('DELETE FROM app.usage_ledger')).toBeGreaterThan(
      indexOf('UPDATE app.sandbox_session_ops'),
    );
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[0]).toBe('done');
    expect(settle?.values[2]).toMatchObject({ modelApiRequests: 3 });
  });

  /**
   * A call the platform made straight to a provider for the subject is an
   * op row the settlement books from. A booked or cancelled one goes; one
   * still running keeps its row under the pseudonym, so its late booking
   * never lands under the subject after the ledger was cleared.
   */
  it('deletes the subject’s finished direct-call rows and pseudonymises the ones still running, before the ledger pass [ERASE-R5]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      if (text.startsWith('DELETE FROM app.sandbox_session_ops'))
        return [{ id: 'op-booked' }];
      if (text.startsWith('UPDATE app.sandbox_session_ops'))
        return [{ id: 'op-running' }];
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });

    await processErasure(fake.sql, 'req-1');

    const ofKind = (prefix: string) =>
      fake.statements.findIndex(
        (s) => s.text.startsWith(prefix) && s.values.includes('direct-call'),
      );
    const removed =
      fake.statements[ofKind('DELETE FROM app.sandbox_session_ops')];
    expect(removed?.text).toBe(
      "DELETE FROM app.sandbox_session_ops WHERE org_id = ? AND kind = ? AND user_id = ? AND (spent_cents IS NOT NULL OR status = 'cancelled') RETURNING id",
    );
    expect(removed?.values).toEqual(['org_1', 'direct-call', 'subject']);
    const pseudonymised =
      fake.statements[ofKind('UPDATE app.sandbox_session_ops')];
    expect(pseudonymised?.values).toEqual([
      'erased-user',
      'org_1',
      'direct-call',
      'subject',
    ]);
    const ledger = fake.statements.findIndex((s) =>
      s.text.startsWith('DELETE FROM app.usage_ledger'),
    );
    expect(ofKind('UPDATE app.sandbox_session_ops')).toBeGreaterThan(
      ofKind('DELETE FROM app.sandbox_session_ops'),
    );
    expect(ledger).toBeGreaterThan(ofKind('UPDATE app.sandbox_session_ops'));
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[2]).toMatchObject({ directCalls: 2 });
  });

  it.each(['automationRuns', 'modelApiRequests'] as const)(
    'keeps dependent identity and ledger passes retryable after %s fails [ERASE-R5]',
    async (failedPass) => {
      vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
      const failedPrefix =
        failedPass === 'automationRuns'
          ? 'DELETE FROM app.automation_runs'
          : 'UPDATE app.sandbox_session_ops';
      const fake = fakeSql((text) => {
        if (
          text.startsWith(
            "UPDATE app.gdpr_erasure_requests SET status = 'running'",
          )
        )
          return [
            {
              organizationId: 'org_1',
              targetUserId: 'subject',
              status: 'running',
            },
          ];
        if (text.startsWith(failedPrefix))
          throw new Error('fixture pass failed');
        if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
        return undefined;
      });
      await processErasure(fake.sql, 'req-1');
      expect(
        fake.statements.some((statement) =>
          statement.text.startsWith('DELETE FROM app.usage_ledger'),
        ),
      ).toBe(false);
      if (failedPass === 'automationRuns')
        expect(
          fake.statements.some((statement) =>
            statement.text.includes('app.sandbox_session_ops'),
          ),
        ).toBe(false);
      const receipt = fake.statements.find(
        (statement) =>
          statement.text.startsWith(
            'UPDATE app.gdpr_erasure_requests SET status = ?',
          ) && statement.text.includes('counts = ?'),
      );
      expect(receipt?.values[0]).toBe('partial');
      expect(receipt?.values[3]).toContain(failedPass);
      expect(receipt?.values[3]).toContain('usageLedger');
    },
  );

  it.each(['automationRuns', 'modelApiRequests'] as const)(
    'keeps the personal ledger when a hold skips prerequisite %s [ERASE-R1]',
    async (heldPass) => {
      let holdNext = false;
      vi.mocked(loadActiveHolds).mockImplementation(async () => {
        if (!holdNext) return noHolds;
        holdNext = false;
        return { orgHeld: false, userMembershipIds: new Set(['subject']) };
      });
      const precedingPrefix =
        heldPass === 'automationRuns'
          ? 'DELETE FROM app.memories'
          : 'DELETE FROM app.automation_runs';
      const fake = fakeSql((text) => {
        if (
          text.startsWith(
            "UPDATE app.gdpr_erasure_requests SET status = 'running'",
          )
        )
          return [
            {
              organizationId: 'org_1',
              targetUserId: 'subject',
              status: 'running',
            },
          ];
        if (text.startsWith(precedingPrefix)) holdNext = true;
        if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
        return undefined;
      });
      await processErasure(fake.sql, 'req-1');
      expect(
        fake.statements.some((statement) =>
          statement.text.includes('app.sandbox_session_ops'),
        ),
      ).toBe(false);
      expect(
        fake.statements.some((statement) =>
          statement.text.startsWith('DELETE FROM app.usage_ledger'),
        ),
      ).toBe(false);
      const receipt = fake.statements.find(
        (statement) =>
          statement.text.startsWith(
            'UPDATE app.gdpr_erasure_requests SET status = ?',
          ) && statement.text.includes('counts = ?'),
      );
      expect(receipt?.values[0]).toBe('partial');
      expect(receipt?.values[3]).toContain(
        `held off by a legal hold: ${heldPass}`,
      );
    },
  );

  it('holds the model-endpoint requests pass off like any other while a hold binds the subject [ERASE-R1]', async () => {
    // The first hold read (the cascade's gate) passes; every per-pass
    // re-read finds the subject held, so no pass touches a row.
    vi.mocked(loadActiveHolds)
      .mockResolvedValueOnce(noHolds)
      .mockResolvedValue({
        orgHeld: false,
        userMembershipIds: new Set(['subject']),
      });
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      return undefined;
    });

    await processErasure(fake.sql, 'req-1');

    expect(
      fake.statements.some((s) => s.text.includes('app.sandbox_session_ops')),
    ).toBe(false);
  });
});

/**
 * A review still waiting on the subject is routing, not history: stamping
 * it with the pseudonym left it waiting on nobody — on no board and in no
 * bell. It moves on through the chain a cleared designation takes, the
 * subject excluded, and only what still names the subject afterwards is
 * pseudonymized.
 */
describe('processErasure — mentions of the subject in other people’s text', () => {
  it('rewrites each stored mention of the subject to the pseudonym, wherever the text is kept', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'u.subject',
            status: 'running',
          },
        ];
      if (text.startsWith('UPDATE app.messages m'))
        return [{ id: 'm-1' }, { id: 'm-2' }];
      if (text.startsWith('UPDATE app.tasks SET description'))
        return [{ id: 't-1' }];
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });

    await processErasure(fake.sql, 'req-1');

    const pattern = String.raw`\[@([^][\\]|\\.)*\]\(mention:user/u\.subject\)`;
    const pseudonym = '[@erased-user](mention:user/erased-user)';
    const rewrites = fake.statements.filter((statement) =>
      statement.values.includes(pattern),
    );
    expect(
      rewrites.map((statement) => statement.text.split(' SET ')[0]),
    ).toEqual([
      'UPDATE app.messages m',
      'UPDATE app.task_discussion_message_meta meta',
      'UPDATE app.tasks',
      'UPDATE app.task_activity',
      'UPDATE app.project_agent_runs',
    ]);
    for (const statement of rewrites) {
      expect(statement.values).toContain(pseudonym);
      expect(statement.values).toContain('org_1');
    }
    const notified = fake.statements.find((statement) =>
      statement.text.startsWith(
        'UPDATE app.task_discussion_message_meta meta SET mentions',
      ),
    );
    expect(notified?.values).toEqual(
      expect.arrayContaining([
        'u.subject',
        'erased-user',
        'org_1',
        [{ type: 'user', id: 'u.subject' }],
      ]),
    );
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[0]).toBe('done');
    expect(settle?.values[2]).toMatchObject({ mentions: 3 });
  });
});

describe('processErasure — the review pass [ERASE-R6]', () => {
  it('hands a waiting review on through the cleared chain, then pseudonymizes what still names the subject', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const task = {
      id: 'task-1',
      reviewerUserId: null,
      archivedAt: null,
    } as unknown as TaskRow;
    const fake = fakeSql((text, values) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      if (text.startsWith('SELECT id FROM app.tasks'))
        return [{ id: 'task-1' }];
      if (text.startsWith('UPDATE app.tasks SET reviewer_user_id = NULL'))
        return values[0] === 'task-1' ? [{ id: 'task-1' }] : [];
      if (text.startsWith('SELECT id FROM app.approvals'))
        return [{ id: 'review-open' }];
      if (text.startsWith('SELECT id, resource_id AS "taskId"'))
        return [
          { id: 'review-open', taskId: 'task-1' },
          { id: 'review-orphan', taskId: 'task-gone' },
        ];
      if (text.startsWith('SELECT id, approved_by AS "approvedBy"'))
        return [
          // The orphan has no task to move to, so it keeps the old stamp.
          {
            id: 'review-orphan',
            approvedBy: null,
            metadata: { requestedFor: 'subject', round: 0 },
          },
          {
            id: 'review-decided',
            approvedBy: 'subject',
            metadata: {
              requestedFor: 'subject',
              response: { decision: 'approve', respondedBy: 'subject' },
            },
          },
        ];
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });
    let statementsAtLoad = -1;
    vi.mocked(loadTaskOrThrow).mockImplementation((_tx, taskId) => {
      if (taskId !== 'task-1') {
        return Promise.reject(
          new TaskError('TASK_NOT_FOUND', 'Task not found', 404),
        );
      }
      statementsAtLoad = fake.statements.length;
      return Promise.resolve(task);
    });

    await processErasure(fake.sql, 'req-1');

    // The designation is cleared BEFORE the chain runs, so the chain starts
    // past the subject's designation — and the subject is excluded from the
    // creator slots too (they are still a member until removed).
    const clearedAt = fake.statements.findIndex((s) =>
      s.text.startsWith('UPDATE app.tasks SET reviewer_user_id = NULL'),
    );
    expect(clearedAt).toBeGreaterThanOrEqual(0);
    expect(statementsAtLoad).toBeGreaterThan(clearedAt);
    expect(loadTaskOrThrow).toHaveBeenCalledWith(
      expect.anything(),
      'task-1',
      'org_1',
    );
    expect(retargetPendingTaskReview).toHaveBeenCalledTimes(1);
    const transactionAt = fake.statements.findIndex(
      (s) => s.text === 'BEGIN isolation level serializable',
    );
    expect(transactionAt).toBeGreaterThanOrEqual(0);
    expect(clearedAt).toBeGreaterThan(transactionAt);
    expect(emitHintInTx).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      entity: 'task',
      entityId: 'task-1',
    });
    expect(retargetPendingTaskReview).toHaveBeenCalledWith(expect.anything(), {
      task,
      excludeUserId: 'subject',
      silent: false,
    });
    // Only rows that still name the subject after the hand-over get the
    // pseudonym; the handed-over review is not rewritten to it.
    const pseudonymized = fake.statements
      .filter((s) => s.text.startsWith('UPDATE app.approvals SET approved_by'))
      .map((s) => s.values);
    expect(pseudonymized).toEqual([
      [null, { requestedFor: 'erased-user', round: 0 }, 'review-orphan'],
      [
        'erased-user',
        {
          requestedFor: 'erased-user',
          response: { decision: 'approve', respondedBy: 'erased-user' },
        },
        'review-decided',
      ],
    ]);
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[0]).toBe('done');
    // One handed over, two pseudonymized, one designation cleared.
    expect(settle?.values[2]).toMatchObject({ reviewDecisions: 4 });
  });

  it('leaves a review that was reassigned after discovery with its new reviewer', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const fake = fakeSql((text) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      ) {
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      }
      if (text.startsWith('SELECT id, resource_id AS "taskId"')) {
        return [{ id: 'review-open', taskId: 'task-1' }];
      }
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      // No designation or pending review still points to the subject in
      // the transaction: the concurrent edit already handed it over.
      return undefined;
    });
    vi.mocked(loadTaskOrThrow).mockResolvedValue({
      id: 'task-1',
      reviewerUserId: 'new-reviewer',
    } as unknown as TaskRow);

    await processErasure(fake.sql, 'req-1');

    expect(retargetPendingTaskReview).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity: 'task' }),
    );
    const settle = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    );
    expect(settle?.values[2]).toMatchObject({ reviewDecisions: 0 });
  });
});

/**
 * The two ways a hand-over can go other than plainly: an archived task,
 * whose card nobody sees, and a hand-over that throws — which must hold
 * back neither the designation's clear nor the pseudonym.
 */
describe('processErasure — the review pass, off the plain path [ERASE-R6]', () => {
  /** `task-1` is designated to the subject and its review waits on them. */
  function reviewPassSql() {
    return fakeSql((text, values) => {
      if (
        text.startsWith(
          "UPDATE app.gdpr_erasure_requests SET status = 'running'",
        )
      )
        return [
          {
            organizationId: 'org_1',
            targetUserId: 'subject',
            status: 'running',
          },
        ];
      if (text.startsWith('SELECT id FROM app.tasks'))
        return [{ id: 'task-1' }];
      if (text.startsWith('UPDATE app.tasks SET reviewer_user_id = NULL'))
        return values[0] === 'task-1' ? [{ id: 'task-1' }] : [];
      if (text.startsWith('SELECT id FROM app.approvals'))
        return [{ id: 'review-open' }];
      if (text.startsWith('SELECT id, resource_id AS "taskId"'))
        return [{ id: 'review-open', taskId: 'task-1' }];
      if (text.startsWith('SELECT id, approved_by AS "approvedBy"'))
        return [
          {
            id: 'review-open',
            approvedBy: null,
            metadata: { requestedFor: 'subject', round: 0 },
          },
          {
            id: 'review-decided',
            approvedBy: 'subject',
            metadata: {
              requestedFor: 'subject',
              response: { decision: 'approve', respondedBy: 'subject' },
            },
          },
        ];
      if (text.startsWith('SELECT EXISTS')) return [{ elsewhere: false }];
      return undefined;
    });
  }

  function settled(fake: ReturnType<typeof fakeSql>): unknown[] | undefined {
    return fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.gdpr_erasure_requests SET status = ?') &&
        s.text.includes('counts = ?'),
    )?.values;
  }

  it('moves the routing of an archived task without asking anyone', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    const task = {
      id: 'task-1',
      reviewerUserId: null,
      archivedAt: 1_700_000_000_000,
    } as unknown as TaskRow;
    vi.mocked(loadTaskOrThrow).mockResolvedValue(task);

    await processErasure(reviewPassSql().sql, 'req-1');

    expect(retargetPendingTaskReview).toHaveBeenCalledWith(expect.anything(), {
      task,
      excludeUserId: 'subject',
      silent: true,
    });
  });

  it('still clears the designation and pseudonymizes everything when a hand-over fails', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);
    vi.mocked(loadTaskOrThrow).mockResolvedValue({
      id: 'task-1',
      reviewerUserId: null,
      archivedAt: null,
    } as unknown as TaskRow);
    vi.mocked(retargetPendingTaskReview).mockRejectedValue(
      new Error('email queue down'),
    );
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fake = reviewPassSql();

    await processErasure(fake.sql, 'req-1');

    expect(error).toHaveBeenCalledWith(
      '[erasure] handing on the review of task task-1 failed:',
      expect.any(Error),
    );
    // The serializable attempt rolled back; the designation goes in a
    // transaction of its own, and the board still hears about it.
    const clears = fake.statements.filter((s) =>
      s.text.startsWith('UPDATE app.tasks SET reviewer_user_id = NULL'),
    );
    expect(clears).toHaveLength(2);
    expect(emitHintInTx).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      entity: 'task',
      entityId: 'task-1',
    });
    // The waiting row falls to the pseudonym as before hand-overs existed,
    // and the decision loses the subject's id: nothing is held back and the
    // pass is not reported as failed.
    const pseudonymized = fake.statements
      .filter((s) => s.text.startsWith('UPDATE app.approvals SET approved_by'))
      .map((s) => s.values[2]);
    expect(pseudonymized).toEqual(['review-open', 'review-decided']);
    const settle = settled(fake);
    expect(settle?.[0]).toBe('done');
    // Two pseudonymized, one designation cleared, none handed over.
    expect(settle?.[2]).toMatchObject({ reviewDecisions: 3 });
    error.mockRestore();
  });
});

describe('requestErasure — the hold gate at filing [ERASE-R1]', () => {
  it('files a durable blocked receipt that records the org-wide hold', async () => {
    vi.mocked(checkOrganizationRateLimit).mockResolvedValue(undefined as never);
    vi.mocked(loadActiveHolds).mockResolvedValue({
      orgHeld: true,
      userMembershipIds: new Set(),
    });
    const fake = fakeSql((text) => {
      if (text.startsWith('SELECT "role" FROM "member"'))
        return [{ role: 'admin' }];
      if (text.startsWith('INSERT INTO app.gdpr_erasure_requests'))
        return [{ id: 'req-1' }];
      return undefined;
    });

    await expect(
      requestErasure(fake.sql, {
        organizationId: 'org_1',
        actorId: 'admin-1',
        targetUserId: 'subject',
        reason: 'Consent withdrawn',
        reasonCode: 'consent_withdrawn',
      }),
    ).rejects.toMatchObject({ code: 'LEGAL_HOLD_BLOCKS_ERASURE' });

    const blocked = fake.statements.find((s) =>
      s.text.startsWith(
        "UPDATE app.gdpr_erasure_requests SET status = 'blocked'",
      ),
    );
    expect(blocked?.text).toContain('error = ?');
    expect(blocked?.values).toEqual(['org_hold', 'req-1']);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('getErasureRequest — the blocked receipt re-checks the hold [ERASE-R2]', () => {
  const blockedRow = (error: string) => ({
    id: 'req-1',
    targetUserId: 'subject',
    reason: 'Consent withdrawn',
    reasonCode: 'consent_withdrawn',
    status: 'blocked',
    requestedBy: 'filer',
    requestedAt: 1,
    slaDeadlineAt: 2,
    effectiveAt: null,
    approvalId: null,
    extensionGrantedAt: null,
    extensionGrantedBy: null,
    extensionReason: null,
    extensionDeadlineAt: null,
    startedAt: null,
    finishedAt: null,
    cancelledBy: null,
    cancellationReason: null,
    threadsTargeted: [],
    counts: null,
    error,
  });
  const receiptOf = (error: string) =>
    fakeSql((text) =>
      text.startsWith('SELECT id, target_user_id') ? [blockedRow(error)] : [],
    );

  it('says the hold was released once no hold covers the subject any more', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue(noHolds);

    const detail = await getErasureRequest(
      receiptOf('user_custodian_hold').sql,
      'org_1',
      'req-1',
    );

    expect(detail?.request).toMatchObject({
      status: 'blocked',
      errorMessage: 'user_custodian_hold',
      holdBlock: { orgHeld: false, userCustodianHeld: false, active: false },
    });
    expect(loadActiveHolds).toHaveBeenCalledWith(expect.anything(), 'org_1');
  });

  it('names the hold that still covers the subject', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue({
      orgHeld: true,
      userMembershipIds: new Set(),
    });

    const detail = await getErasureRequest(
      receiptOf('org_hold').sql,
      'org_1',
      'req-1',
    );

    expect(detail?.request).toMatchObject({
      holdBlock: { orgHeld: true, userCustodianHeld: false, active: true },
    });
  });

  it.each([
    {
      threads: 2,
      documents: 3,
      automationRuns: 1,
    },
    {
      threads: { rows: 2, skippedByHold: 4 },
      documents: { rows: 3, skippedByHold: 5 },
      automationRuns: { rows: 1, skippedByHold: 6 },
    },
  ])(
    'keeps summary erased counts consistent with the breakdown [ERASE-R9]',
    async (counts) => {
      const fake = fakeSql((text) =>
        text.startsWith('SELECT id, target_user_id')
          ? [
              {
                ...blockedRow('legacy_automation_hold'),
                status: 'partial',
                counts,
              },
            ]
          : [],
      );

      const detail = await getErasureRequest(fake.sql, 'org_1', 'req-1');

      expect(detail?.request).toMatchObject({
        threadsErased: 2,
        documentsErased: 3,
        wfExecutionsErased: 1,
        threadsSkippedByHold: typeof counts.threads === 'number' ? 0 : 4,
        documentsSkippedByHold: typeof counts.documents === 'number' ? 0 : 5,
        perCategorySnapshot: counts,
      });
    },
  );

  it('does not check holds for a receipt that is not blocked', async () => {
    const fake = fakeSql((text) =>
      text.startsWith('SELECT id, target_user_id')
        ? [{ ...blockedRow(''), status: 'pending', error: null }]
        : [],
    );

    const detail = await getErasureRequest(fake.sql, 'org_1', 'req-1');

    expect(detail?.request).not.toHaveProperty('holdBlock');
    expect(loadActiveHolds).not.toHaveBeenCalled();
  });
});

describe('requestErasure — the limiter [ERASE-R8]', () => {
  const args = {
    organizationId: 'org_1',
    actorId: 'admin-1',
    targetUserId: 'subject',
    reason: 'Consent withdrawn',
    reasonCode: 'consent_withdrawn',
  };
  const adminOnly = (text: string) =>
    text.startsWith('SELECT "role" FROM "member"')
      ? [{ role: 'admin' }]
      : undefined;

  it('records a rate-limited filing as an audited denial', async () => {
    vi.mocked(checkOrganizationRateLimit).mockRejectedValue(
      new RateLimitExceededError('over', 1_000),
    );
    const fake = fakeSql(adminOnly);

    await expect(requestErasure(fake.sql, args)).rejects.toBeInstanceOf(
      ErasureError,
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'gdpr_erasure_denied',
        errorMessage: 'rate_limited',
      }),
    );
  });

  it('surfaces a limiter outage instead of writing it into the audit chain as a denial', async () => {
    vi.mocked(checkOrganizationRateLimit).mockRejectedValue(
      new Error('db down'),
    );
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = fakeSql(adminOnly);

    await expect(requestErasure(fake.sql, args)).rejects.toThrow('db down');
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('INSERT INTO app.gdpr_erasure_requests'),
      ),
    ).toBe(false);
    warn.mockRestore();
  });
});
