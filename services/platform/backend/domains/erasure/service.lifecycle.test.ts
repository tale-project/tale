// @vitest-environment node

/**
 * The erasure receipt's lifecycle transitions over a recording fake of the
 * postgres.js tag: what each door WRITES (the statements and their values)
 * and what it hands to the job queue, the audit chain and the realtime
 * outbox. The full cascade over a real database runs in the integration
 * check; these pin the transitions that used to be silent or unguarded —
 * the Retry of a receipt blocked at filing (policy re-applied, CAS re-arm),
 * the execution-time hold block (audited), the limiter outage (not a
 * denial), and the project-agent-runs pass.
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
import {
  ErasureError,
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
  tag.begin = (callback: (tx: typeof tag) => unknown): unknown => callback(tag);
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
  it('parks a receipt blocked at filing for the second admin under dual approval — no processor enqueued', async () => {
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

  it('re-schedules a receipt blocked at filing behind the cooling-off window', async () => {
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

  it('re-runs a partial receipt immediately without re-reading the policy', async () => {
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

  it('keeps the fast re-run for a receipt blocked at execution time (schedule stamp present)', async () => {
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

  it('re-arms with a status compare-and-set — a receipt that settled meanwhile is not enqueued', async () => {
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
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('processErasure', () => {
  it('audits and hints an execution-time hold block, and clears the start stamp', async () => {
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

  it('pseudonymises the project-agent runs the subject started and counts the pass on the receipt', async () => {
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
});

describe('requestErasure — the limiter', () => {
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
