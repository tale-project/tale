import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

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

async function failureAuditRows(t: T) {
  return await t.run(async (ctx) => {
    const rows = [];
    for (const r of await ctx.db.query('auditLogs').collect()) {
      if (
        r.organizationId === ORG &&
        r.action === 'audit_log.integrity_check_failed'
      ) {
        rows.push(r);
      }
    }
    return rows;
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
});
