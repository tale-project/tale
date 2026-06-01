import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives
// at convex/audit_logs/, so resolve glob keys against that base.
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

const ORG = 'org_audit_appendonly';

type T = TestConvex<typeof schema>;

async function seedEntry(t: T, action: string): Promise<Id<'auditLogs'>> {
  return await t.mutation(
    internal.audit_logs.internal_mutations.createAuditLog,
    {
      organizationId: ORG,
      actorId: 'tester',
      actorType: 'system',
      action,
      category: 'data',
      resourceType: 'customer',
      status: 'success',
    },
  );
}

async function chainRowsAsc(t: T) {
  return await t.run(async (ctx) => {
    const rows = [];
    for await (const row of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', ORG),
      )
      .order('asc')) {
      rows.push(row);
    }
    return rows;
  });
}

async function verify(t: T) {
  return await t.query(
    internal.audit_logs.integrity_check.verifyAuditChainForOrg,
    { organizationId: ORG },
  );
}

// #1505: the append-only guarantee is enforced by *detection*, not by RLS
// (the RLS `modify` rule must allow the forward chain-link patch
// `createAuditLog` performs, so it cannot also forbid tampering). These tests
// lock in that the hash chain catches any out-of-band mutation or deletion.
describe('audit log append-only guarantee', () => {
  it('verifies a clean chain written through createAuditLog', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');
    await seedEntry(t, 'customer.delete');

    const result = await verify(t);
    expect(result.valid).toBe(true);
    expect(result.verifiedCount).toBe(3);
    expect(result.firstBrokenAt).toBeUndefined();
  });

  it('detects an out-of-band mutation to a historical row', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');
    await seedEntry(t, 'customer.delete');

    // Tamper with a hashed field on the oldest row, bypassing createAuditLog.
    const rows = await chainRowsAsc(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(rows[0]._id, { action: 'customer.tampered' });
    });

    const result = await verify(t);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenAt?.logId).toBe(String(rows[0]._id));
  });

  it('detects a deleted mid-chain row (broken hash linkage)', async () => {
    const t = convexTest(schema, modules);
    await seedEntry(t, 'customer.create');
    await seedEntry(t, 'customer.update');
    await seedEntry(t, 'customer.delete');

    // Hard-delete the middle row out-of-band; the next row's previousHash now
    // dangles, so the chain no longer links.
    const rows = await chainRowsAsc(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(rows[1]._id);
    });

    const result = await verify(t);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenAt).toBeDefined();
  });
});
