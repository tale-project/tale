import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { classifyIntegrityFinding } from './integrity_check';

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

// #1505: the scheduled integrity check must raise an OUT-OF-BAND alert (the
// notification bell + Slack fan-out), not just a console line, so a tampered
// chain is actually noticed. These tests lock in that behaviour end-to-end.
describe('scheduled audit-log integrity alert (#1505)', () => {
  it('writes no notification when the chain verifies cleanly', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');

    await t.action(
      internal.audit_logs.integrity_check.runAuditIntegrityCheck,
      {},
    );

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

    await t.action(
      internal.audit_logs.integrity_check.runAuditIntegrityCheck,
      {},
    );

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

      await t.action(
        internal.audit_logs.integrity_check.runAuditIntegrityCheck,
        {},
      );

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
