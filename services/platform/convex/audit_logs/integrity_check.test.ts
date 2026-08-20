import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  classifyIntegrityFinding,
  computeIncidentFingerprint,
} from './integrity_check';

// convex-test module map keyed relative to the convex/ root. This file lives
// at convex/audit_logs/, so resolve glob keys against that base (mirrors
// append_only.test.ts).
const TEST_DIR_FROM_CONVEX_ROOT = 'audit_logs';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_audit_integrity_alert';

type T = TestConvex<typeof schema>;

async function seedEntry(t: T, action: string): Promise<void> {
  await t.mutation(internal.audit_logs.internal_mutations.createAuditLog, {
    organizationId: ORG,
    actorId: 'tester',
    actorType: 'system',
    action,
    category: 'data',
    resourceType: 'customer',
    status: 'success',
  });
}

async function notificationsForOrg(t: T) {
  return await t.run(async (ctx) => {
    const rows = [];
    for (const n of await ctx.db.query('notifications').collect()) {
      if (n.organizationId === ORG) rows.push(n);
    }
    return rows;
  });
}

async function auditRowsByAction(t: T, action: string) {
  return await t.run(async (ctx) => {
    const rows = [];
    for (const r of await ctx.db.query('auditLogs').collect()) {
      if (r.organizationId === ORG && r.action === action) rows.push(r);
    }
    return rows;
  });
}

async function failureAuditRows(t: T) {
  return auditRowsByAction(t, 'audit_log.integrity_check_failed');
}

async function runCheck(t: T): Promise<void> {
  await t.action(
    internal.audit_logs.integrity_check.runAuditIntegrityCheck,
    {},
  );
  await drainScheduledFunctions(t);
}

/**
 * Wait until no scheduled function is pending or running. The alert path
 * schedules a fire-and-forget Slack dispatch (`runAfter(0, …)`) whose
 * callback runs on a real timer OUTSIDE the awaited call chain. On an idle
 * machine it fires immediately and harmlessly; on a loaded CI worker the
 * callbacks pile up and fire at arbitrary later points, interleaving with
 * the test's next `t.run`/action against convex-test's shared transaction
 * bookkeeping — observed as a re-broken checkpoint that the following run
 * read as healed (run 3 of the clear-fingerprint test saw a clean world).
 * Draining makes each step start from a quiescent world, so the sequence of
 * runs is deterministic under any scheduler timing.
 */
async function drainScheduledFunctions(t: T): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const busy = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect();
      return jobs.some(
        (job) =>
          job.state.kind === 'pending' || job.state.kind === 'inProgress',
      );
    });
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('scheduled functions did not drain — investigate the test');
}

// _ids of the org's audit rows in chain (timestamp) order, captured before any
// run appends its own integrity rows — so tests can target a specific link.
async function seededRowIds(t: T): Promise<Id<'auditLogs'>[]> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', ORG),
      )
      .order('asc')
      .collect();
    return rows.map((r) => r._id);
  });
}

// Break (or heal) a row by rewriting a hashed field WITHOUT going through
// createAuditLog, exactly as the existing tamper test does.
async function patchAction(
  t: T,
  id: Id<'auditLogs'>,
  action: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { action });
  });
}

// Seed the local member mirror so the org-membership gate resolves without the
// (test-unavailable) Better Auth component — mirrors support_cases.test.ts.
async function seedMember(
  t: T,
  userId: string,
  memberId: string,
  role: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId,
      userId,
      organizationId: ORG,
      role,
      createdAt: 0,
    });
  });
}

// #1505: the scheduled integrity check must raise an OUT-OF-BAND alert (the
// notification bell + Slack fan-out), not just a console line, so a tampered
// chain is actually noticed. These tests lock in that behaviour end-to-end.
describe('scheduled audit-log integrity alert (#1505)', () => {
  it('writes no notification when the chain verifies cleanly', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');

    await runCheck(t);

    expect(await notificationsForOrg(t)).toHaveLength(0);
    expect(await failureAuditRows(t)).toHaveLength(0);
  });

  it('raises a critical security notification when the chain is tampered', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');
    await seedEntry(t, 'customer.delete');

    // Tamper a hashed field on the oldest row, bypassing createAuditLog.
    await t.run(async (ctx) => {
      const oldest = await ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_timestamp', (q) =>
          q.eq('organizationId', ORG),
        )
        .order('asc')
        .first();
      if (!oldest) throw new Error('seed failed');
      await ctx.db.patch(oldest._id, { action: 'customer.tampered' });
    });

    await runCheck(t);

    // In-band audit row.
    expect(await failureAuditRows(t)).toHaveLength(1);

    // Out-of-band alert: one critical security notification carrying the
    // i18n keys the bell + Slack sink render.
    const notes = await notificationsForOrg(t);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      category: 'security',
      severity: 'critical',
      titleKey: 'auditIntegrityFailed',
      bodyKey: 'auditIntegrityFailedDetails',
    });
    expect(notes[0].params?.reason).toBeTruthy();
  });

  it('raises a calm WARNING (not critical) when a checkpoint is unverifiable for lack of a key', async () => {
    // A fresh stack with no TALE_AUDIT_SIGNING_KEY but a signed checkpoint is a
    // CONFIG gap, not tampering. The alert must be a warning the operator can
    // act on — never a scary "tampering detected" critical.
    const prevKey = process.env.TALE_AUDIT_SIGNING_KEY;
    delete process.env.TALE_AUDIT_SIGNING_KEY;
    try {
      const t = convexTest(schema, modules);
      await seedEntry(t, 'customer.create');
      // Insert a signed retention checkpoint while no key is configured →
      // verifyCheckpointSignature returns 'no-key'.
      await t.run(async (ctx) => {
        await ctx.db.insert('auditLogCheckpoints', {
          organizationId: ORG,
          subtype: 'retention',
          lastDeletedHash: 'deadbeef',
          maxDeletedTimestamp: 1,
          deletedCount: 1,
          signature: 'a-signature-without-a-key-to-verify-it',
          signatureVersion: 2,
          createdAt: 1,
        });
      });

      await runCheck(t);

      // No "tampering" failure row; an "unverifiable" config row instead.
      expect(await failureAuditRows(t)).toHaveLength(0);
      expect(
        await auditRowsByAction(t, 'audit_log.integrity_unverifiable'),
      ).toHaveLength(1);

      const notes = await notificationsForOrg(t);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        category: 'security',
        severity: 'warning',
        titleKey: 'auditIntegrityUnverifiable',
        bodyKey: 'auditIntegrityUnverifiableDetails',
      });
    } finally {
      if (prevKey === undefined) delete process.env.TALE_AUDIT_SIGNING_KEY;
      else process.env.TALE_AUDIT_SIGNING_KEY = prevKey;
    }
  });
});

// #1845: the daily cron must stop re-alerting for the SAME unresolved break.
// The in-band audit row still lands every run (the durable record); only the
// out-of-band notification is deduped by an incident fingerprint.
describe('incident dedup (#1845)', () => {
  it('writes an audit row every run but alerts only once for the same break', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');
    const [oldest] = await seededRowIds(t);
    // Break the oldest (first) row: the walk breaks before verifying anything,
    // so the cursor never advances and the SAME break is re-hit every run.
    await patchAction(t, oldest, 'customer.tampered');

    await runCheck(t);
    await runCheck(t);

    // Durable in-band record on BOTH runs...
    expect(await failureAuditRows(t)).toHaveLength(2);
    // ...but a single out-of-band alert for the unchanged break.
    expect(await notificationsForOrg(t)).toHaveLength(1);
  });

  it('re-alerts when the break moves to a different row', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');
    const [row0, row1] = await seededRowIds(t);

    await patchAction(t, row0, 'customer.tampered');
    await runCheck(t);
    expect(await notificationsForOrg(t)).toHaveLength(1);

    // Heal row0 and break row1 instead → different firstBrokenAt.logId → a new
    // fingerprint the dedup must let through.
    await patchAction(t, row0, 'customer.create');
    await patchAction(t, row1, 'customer.tampered');
    await runCheck(t);
    expect(await notificationsForOrg(t)).toHaveLength(2);
  });

  it('clears the fingerprint on a clean run so an identical re-break re-alerts', async () => {
    // A signed checkpoint with no key configured is a CONFIG finding that
    // recurs every run (checkpoint verification is not cursor-gated), so the
    // SAME checkpoint id yields a STABLE fingerprint across runs — the case
    // where "clear on clean" actually changes the outcome.
    const prevKey = process.env.TALE_AUDIT_SIGNING_KEY;
    delete process.env.TALE_AUDIT_SIGNING_KEY;
    try {
      const t = convexTest(schema, modules);
      await seedEntry(t, 'customer.create');
      const cpId = await t.run(async (ctx) =>
        ctx.db.insert('auditLogCheckpoints', {
          organizationId: ORG,
          subtype: 'retention',
          lastDeletedHash: 'deadbeef',
          maxDeletedTimestamp: 1,
          deletedCount: 1,
          signature: 'sig-with-no-key',
          signatureVersion: 2,
          createdAt: 1,
        }),
      );

      await runCheck(t);
      expect(await notificationsForOrg(t)).toHaveLength(1);

      // Heal by dropping the signature (an unsigned checkpoint verifies) → the
      // clean run clears the stored fingerprint.
      await t.run(async (ctx) => {
        await ctx.db.patch(cpId, { signature: undefined });
      });
      await runCheck(t);
      expect(await notificationsForOrg(t)).toHaveLength(1);

      // Re-break the SAME checkpoint → identical fingerprint. It re-alerts ONLY
      // because the clean run cleared the fingerprint (else it would dedup).
      await t.run(async (ctx) => {
        await ctx.db.patch(cpId, { signature: 'sig-with-no-key' });
      });
      await runCheck(t);
      expect(await notificationsForOrg(t)).toHaveLength(2);
    } finally {
      if (prevKey === undefined) delete process.env.TALE_AUDIT_SIGNING_KEY;
      else process.env.TALE_AUDIT_SIGNING_KEY = prevKey;
    }
  });
});

// #1845: the alert deep-links straight to the offending audit row.
describe('integrity alert deep-link (#1845)', () => {
  it('carries link.logId pointing at the broken row for a hash break', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');
    const [oldest] = await seededRowIds(t);
    await patchAction(t, oldest, 'customer.tampered');

    await runCheck(t);

    const notes = await notificationsForOrg(t);
    expect(notes).toHaveLength(1);
    expect(notes[0].link).toEqual({ kind: 'audit-logs', logId: oldest });
  });

  it('omits link.logId for a config (checkpoint-only) finding', async () => {
    const prevKey = process.env.TALE_AUDIT_SIGNING_KEY;
    delete process.env.TALE_AUDIT_SIGNING_KEY;
    try {
      const t = convexTest(schema, modules);
      await seedEntry(t, 'customer.create');
      await t.run(async (ctx) => {
        await ctx.db.insert('auditLogCheckpoints', {
          organizationId: ORG,
          subtype: 'retention',
          lastDeletedHash: 'deadbeef',
          maxDeletedTimestamp: 1,
          deletedCount: 1,
          signature: 'a-signature-without-a-key-to-verify-it',
          signatureVersion: 2,
          createdAt: 1,
        });
      });

      await runCheck(t);

      const notes = await notificationsForOrg(t);
      expect(notes).toHaveLength(1);
      // No single row to point at → link stays page-level (no logId).
      expect(notes[0].link).toEqual({ kind: 'audit-logs' });
    } finally {
      if (prevKey === undefined) delete process.env.TALE_AUDIT_SIGNING_KEY;
      else process.env.TALE_AUDIT_SIGNING_KEY = prevKey;
    }
  });
});

describe('computeIncidentFingerprint', () => {
  it('is stable for the same break and changes when the broken row changes', () => {
    const a = computeIncidentFingerprint({
      findingKind: 'tampering',
      firstBrokenLogId: 'log1',
    });
    const b = computeIncidentFingerprint({
      findingKind: 'tampering',
      firstBrokenLogId: 'log1',
    });
    const c = computeIncidentFingerprint({
      findingKind: 'tampering',
      firstBrokenLogId: 'log2',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('distinguishes a config checkpoint finding from a tampering one', () => {
    expect(
      computeIncidentFingerprint({
        findingKind: 'config',
        checkpointId: 'cp1',
      }),
    ).not.toBe(
      computeIncidentFingerprint({
        findingKind: 'tampering',
        checkpointId: 'cp1',
      }),
    );
  });
});

describe('classifyIntegrityFinding', () => {
  it('treats a hash-chain break as tampering', () => {
    expect(
      classifyIntegrityFinding({ firstBrokenAt: { logId: 'log123' } }),
    ).toEqual({ kind: 'tampering', reason: 'hash chain broken at log log123' });
  });

  it('treats a "not configured" checkpoint verdict as a config gap', () => {
    const reason =
      'Checkpoint is signed but TALE_AUDIT_SIGNING_KEY is not configured — operator must restore the key to verify.';
    expect(
      classifyIntegrityFinding({ checkpointMismatch: { reason } }),
    ).toEqual({ kind: 'config', reason });
  });

  it('treats a signature mismatch as tampering', () => {
    const reason = 'HMAC signature does not match the active or previous key.';
    expect(
      classifyIntegrityFinding({ checkpointMismatch: { reason } }),
    ).toEqual({ kind: 'tampering', reason });
  });

  it('falls back to tampering when nothing specific is reported', () => {
    expect(classifyIntegrityFinding({})).toEqual({
      kind: 'tampering',
      reason: 'audit log chain failed verification',
    });
  });
});

// #1845 item 4: the admin-only status query backing the integrity panel.
describe('getIntegrityStatus (#1845)', () => {
  const ADMIN = 'user_admin';
  const MEMBER = 'user_member';

  it('returns null for an org with no progress row yet', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, 'm_admin', 'admin');
    expect(
      await t
        .withIdentity({ subject: ADMIN })
        .query(api.audit_logs.verify_integrity.getIntegrityStatus, {
          organizationId: ORG,
        }),
    ).toBeNull();
  });

  it('reports an active alert after a break is detected', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, 'm_admin', 'admin');
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');
    const [oldest] = await seededRowIds(t);
    await patchAction(t, oldest, 'customer.tampered');
    await runCheck(t);

    const status = await t
      .withIdentity({ subject: ADMIN })
      .query(api.audit_logs.verify_integrity.getIntegrityStatus, {
        organizationId: ORG,
      });
    expect(status).not.toBeNull();
    expect(status?.alertActive).toBe(true);
    expect(status?.lastAlertedFingerprint).toBeTruthy();
    // The break was at the head anchor, so verification never reached the live
    // head this run.
    expect(status?.headReached).toBe(false);
  });

  it('rejects a non-admin caller', async () => {
    const t = convexTest(schema, modules);
    // Member is seeded, so the ONLY rejection cause is the admin gate.
    await seedMember(t, MEMBER, 'm_member', 'member');
    await expect(
      t
        .withIdentity({ subject: MEMBER })
        .query(api.audit_logs.verify_integrity.getIntegrityStatus, {
          organizationId: ORG,
        }),
    ).rejects.toThrow();
  });
});
