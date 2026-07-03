import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
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

const ORG = 'org_audit_retention_holds';
const FAR_FUTURE = 4_102_444_800_000; // 2100-01-01: every seeded row is "old".

type T = TestConvex<typeof schema>;

interface SeedOpts {
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
}

async function seedEntry(
  t: T,
  action: string,
  opts: SeedOpts = {},
): Promise<Id<'auditLogs'>> {
  return await t.mutation(
    internal.audit_logs.internal_mutations.createAuditLog,
    {
      organizationId: ORG,
      actorId: opts.actorId ?? 'tester',
      actorType: 'system',
      action,
      category: 'data',
      resourceType: opts.resourceType ?? 'customer',
      resourceId: opts.resourceId,
      status: 'success',
    },
  );
}

async function deleteOldLogs(t: T, protectedUserIds: string[]) {
  return await t.mutation(
    internal.audit_logs.internal_mutations.deleteOldLogs,
    {
      organizationId: ORG,
      olderThanTimestamp: FAR_FUTURE,
      protectedUserIds,
    },
  );
}

async function verify(t: T) {
  return await t.query(
    internal.audit_logs.integrity_check.verifyAuditChainForOrg,
    { organizationId: ORG },
  );
}

async function actionsAsc(t: T): Promise<string[]> {
  return await t.run(async (ctx) => {
    const actions: string[] = [];
    for await (const row of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', ORG),
      )
      .order('asc')) {
      actions.push(row.action);
    }
    return actions;
  });
}

// #1844: audit-log retention and custodian legal holds are two compliance
// features that compose. The old `deleteOldLogs` skipped each protected row
// per-row while hard-deleting the unprotected rows around it, stranding the
// survivors as non-contiguous islands in the hash chain. The verifier
// re-anchors only at the chain head and then demands strict `previousHash`
// contiguity, so the next integrity run reported a deterministic, permanent
// false "hash chain broken" tamper alarm. The fix stops the deletion sweep at
// the first protected row, deleting only the contiguous unprotected prefix so
// the surviving chain stays contiguous by construction.
describe('audit retention around custodian-hold rows (#1844)', () => {
  it('keeps the surviving chain contiguous and verifiable across a held actor', async () => {
    const t = convexTest(schema, modules);
    // Interleave a held user's rows with an unprotected actor's rows. The
    // pre-fix per-row skip would delete a1/a2/a3 and keep only the two held
    // rows, leaving them non-contiguous.
    await seedEntry(t, 'a1', { actorId: 'alice' });
    await seedEntry(t, 'a2', { actorId: 'alice' });
    await seedEntry(t, 'held1', { actorId: 'bob-held' });
    await seedEntry(t, 'a3', { actorId: 'alice' });
    await seedEntry(t, 'held2', { actorId: 'bob-held' });

    const result = await deleteOldLogs(t, ['bob-held']);

    // Only the contiguous unprotected prefix (a1, a2) is deleted; the sweep
    // stops at the first held row. hasMore is false — nothing more is
    // deletable until the hold is released.
    expect(result.deletedCount).toBe(2);
    expect(result.hasMore).toBe(false);

    // The held rows and the unprotected rows behind them all survive; a
    // retention bookkeeping row is appended at the tail.
    const actions = await actionsAsc(t);
    expect(actions).toEqual([
      'held1',
      'a3',
      'held2',
      'audit_log.retention_deleted',
    ]);

    // The whole point: no false tamper alarm.
    const verdict = await verify(t);
    expect(verdict.valid).toBe(true);
    expect(verdict.firstBrokenAt).toBeUndefined();
  });

  it('preserves rows that merely TARGET a held user (resourceType user)', async () => {
    const t = convexTest(schema, modules);
    // Row authored by an admin about the held user — the subject, not the
    // actor, is on hold. Must still preserve chain contiguity.
    await seedEntry(t, 'a1', { actorId: 'admin' });
    await seedEntry(t, 'about-held', {
      actorId: 'admin',
      resourceType: 'user',
      resourceId: 'carol-held',
    });
    await seedEntry(t, 'a2', { actorId: 'admin' });

    const result = await deleteOldLogs(t, ['carol-held']);

    expect(result.deletedCount).toBe(1); // only a1; stop at the held target.
    const actions = await actionsAsc(t);
    expect(actions).toEqual([
      'about-held',
      'a2',
      'audit_log.retention_deleted',
    ]);

    const verdict = await verify(t);
    expect(verdict.valid).toBe(true);
  });

  it('resumes deleting the backlog once the hold is released', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'a1', { actorId: 'alice' });
    await seedEntry(t, 'held1', { actorId: 'bob-held' });
    await seedEntry(t, 'a2', { actorId: 'alice' });

    // Hold active: only the prefix before the held row is deleted.
    const held = await deleteOldLogs(t, ['bob-held']);
    expect(held.deletedCount).toBe(1);
    expect((await verify(t)).valid).toBe(true);

    // Hold released: the previously protected row and the rows behind it are
    // now eligible, and the chain stays contiguous after the cut.
    const released = await deleteOldLogs(t, []);
    expect(released.deletedCount).toBeGreaterThan(0);
    const verdict = await verify(t);
    expect(verdict.valid).toBe(true);
    expect(verdict.firstBrokenAt).toBeUndefined();
  });
});
