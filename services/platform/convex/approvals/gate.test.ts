// @vitest-environment node

/**
 * The approvals gate, exercised against a real Convex world.
 *
 * The gate is the one decision both live-write surfaces share, so these tests
 * pin what it decides and what it records: a read is never gated, a write is
 * gated once and remembered, approving it lets a retry through, a rejection
 * stays rejected, and a decision recorded for one organization is invisible to
 * another in both directions.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'approvals';
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

const ORG_A = 'org_gate_a';
const ORG_B = 'org_gate_b';

type T = TestConvex<typeof schema>;

function evaluate(t: T, args: Record<string, unknown>) {
  return t.mutation(internal.approvals.gate.evaluateApprovalGate, {
    connector: 'github',
    action: 'create_issue',
    effect: 'write',
    ...args,
  } as Parameters<typeof t.mutation>[1]);
}

async function approvalsFor(t: T, resourceKey: string) {
  return await t.run(async (ctx) => {
    const rows = [];
    for await (const row of ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q
          .eq('resourceType', 'integration_operation')
          .eq('resourceId', resourceKey),
      )) {
      rows.push(row);
    }
    return rows;
  });
}

describe('approvals gate — the write policy', () => {
  it('never gates a read and leaves no record behind', async () => {
    const t = convexTest(schema, modules);
    const decision = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_read',
      action: 'search',
      effect: 'read',
    });
    expect(decision).toEqual({ decision: 'allow' });
    expect(await approvalsFor(t, 'op_read')).toHaveLength(0);
  });

  it('gates a write: records a pending approval and asks for a human', async () => {
    const t = convexTest(schema, modules);
    const decision = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_write_1',
      requestedBy: 'user_1',
      input: { owner: 'tale', repo: 'tale', title: 'Ship it' },
    });
    expect(decision.decision).toBe('needs-approval');
    const rows = await approvalsFor(t, 'op_write_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: ORG_A,
      status: 'pending',
      resourceType: 'integration_operation',
      resourceId: 'op_write_1',
    });
    expect(rows[0].metadata).toMatchObject({
      source: 'integration',
      connector: 'github',
      action: 'create_issue',
      operationType: 'write',
      requestedBy: 'user_1',
    });
  });

  it('lets a platform-internal write run with no card and no record', async () => {
    // The gate exists to catch a write LEAVING the tenant. Moving a task card
    // is the platform acting on itself — asking a human buys nothing and used
    // to bury the approvals that matter.
    const t = convexTest(schema, modules);
    const decision = await evaluate(t, {
      organizationId: ORG_A,
      source: 'automation',
      resourceKey: 'run_1:mark_task_started',
      connector: 'task',
      action: 'update_status',
      platformInternal: true,
    });
    expect(decision).toEqual({ decision: 'allow' });
    expect(await approvalsFor(t, 'run_1:mark_task_started')).toHaveLength(0);
  });

  it('an org rule can tighten a platform-internal write back to asking', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('configCache', {
        organizationId: ORG_A,
        domain: 'governance',
        key: 'approval_policy',
        config: {
          rules: [{ connector: 'task', decision: 'require_approval' }],
        },
        syncedAt: 0,
      });
    });
    const decision = await evaluate(t, {
      organizationId: ORG_A,
      source: 'automation',
      resourceKey: 'run_2:mark_task_started',
      connector: 'task',
      action: 'update_status',
      platformInternal: true,
    });
    expect(decision.decision).toBe('needs-approval');
  });

  it('an org rule can auto-approve one outbound action', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('configCache', {
        organizationId: ORG_A,
        domain: 'governance',
        key: 'approval_policy',
        config: {
          rules: [{ action: 'github.create_issue', decision: 'auto_approve' }],
        },
        syncedAt: 0,
      });
    });
    const allowed = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_allowed',
    });
    expect(allowed).toEqual({ decision: 'allow' });
    expect(await approvalsFor(t, 'op_allowed')).toHaveLength(0);
    // A different action of the same connector still asks.
    const gated = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_gated',
      action: 'comment_issue',
    });
    expect(gated.decision).toBe('needs-approval');
  });

  it('a malformed policy file falls back to the built-in rule', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('configCache', {
        organizationId: ORG_A,
        domain: 'governance',
        key: 'approval_policy',
        config: { rules: 'not-a-list' },
        syncedAt: 0,
      });
    });
    // Outbound still asks…
    expect(
      (
        await evaluate(t, {
          organizationId: ORG_A,
          source: 'integration',
          resourceKey: 'op_malformed_out',
        })
      ).decision,
    ).toBe('needs-approval');
    // …and platform-internal still runs.
    expect(
      await evaluate(t, {
        organizationId: ORG_A,
        source: 'automation',
        resourceKey: 'op_malformed_in',
        connector: 'task',
        action: 'comment',
        platformInternal: true,
      }),
    ).toEqual({ decision: 'allow' });
  });

  it('a decision already on file survives a policy that would now allow it', async () => {
    const t = convexTest(schema, modules);
    // A run parked on a pending card; the operator then auto-approves the
    // action. The parked operation keeps its card rather than being stranded.
    const first = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_parked',
    });
    expect(first.decision).toBe('needs-approval');
    await t.run(async (ctx) => {
      await ctx.db.insert('configCache', {
        organizationId: ORG_A,
        domain: 'governance',
        key: 'approval_policy',
        config: {
          rules: [{ action: 'github.create_issue', decision: 'auto_approve' }],
        },
        syncedAt: 0,
      });
    });
    const retry = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_parked',
    });
    expect(retry).toEqual(first);
  });

  it('reuses the same pending approval when the same operation is retried', async () => {
    const t = convexTest(schema, modules);
    const first = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_dedupe',
    });
    const second = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_dedupe',
    });
    expect(second).toEqual(first);
    // Still exactly one record — the retry did not create a duplicate.
    expect(await approvalsFor(t, 'op_dedupe')).toHaveLength(1);
  });

  it('lets an approved operation through on retry and consumes the record', async () => {
    const t = convexTest(schema, modules);
    const first = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_approve',
    });
    expect(first.decision).toBe('needs-approval');
    const approvalId = (first as { approvalId: Id<'approvals'> }).approvalId;

    // A human approves — the resolution mutation moves the row to `executing`.
    await t.run(async (ctx) => {
      await ctx.db.patch(approvalId, {
        status: 'executing',
        approvedBy: 'admin_1',
        reviewedAt: Date.now(),
      });
    });

    const retry = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_approve',
    });
    expect(retry).toEqual({ decision: 'allow', approvalId });

    // Consumed: the record is `completed`, so it leaves the active view...
    const row = await t.run(async (ctx) => await ctx.db.get(approvalId));
    expect(row?.status).toBe('completed');
    expect(row?.executedAt).toBeTypeOf('number');

    // ...and a durable resume that re-enters still reads it as granted.
    const again = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_approve',
    });
    expect(again).toEqual({ decision: 'allow', approvalId });
  });

  it('reports a rejected operation, with the reviewer reason, and does not re-run', async () => {
    const t = convexTest(schema, modules);
    const first = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_reject',
    });
    const approvalId = (first as { approvalId: Id<'approvals'> }).approvalId;
    await t.run(async (ctx) => {
      await ctx.db.patch(approvalId, {
        status: 'rejected',
        approvedBy: 'admin_1',
        reviewedAt: Date.now(),
        metadata: { comments: 'not this time' },
      });
    });

    const retry = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'op_reject',
    });
    expect(retry).toEqual({
      decision: 'rejected',
      approvalId,
      reason: 'not this time',
    });
    // No fresh pending record was created for the rejected operation.
    expect(await approvalsFor(t, 'op_reject')).toHaveLength(1);
  });

  it('records an automation node approval keyed to its run and node', async () => {
    const t = convexTest(schema, modules);
    const decision = await evaluate(t, {
      organizationId: ORG_A,
      source: 'automation',
      resourceKey: 'run_7:notify',
      runId: 'run_7',
      nodeId: 'notify',
      nodeType: 'github.create_issue',
      automation: 'ops/notify',
    });
    expect(decision.decision).toBe('needs-approval');
    const rows = await approvalsFor(t, 'run_7:notify');
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({
      source: 'automation',
      runId: 'run_7',
      nodeId: 'notify',
      automation: 'ops/notify',
    });
  });
});

describe('approvals gate — tenant isolation', () => {
  it('keeps one organization from seeing or reusing another organization decision', async () => {
    const t = convexTest(schema, modules);
    // Same operation identity for both tenants.
    const a = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'shared_key',
    });
    const b = await evaluate(t, {
      organizationId: ORG_B,
      source: 'integration',
      resourceKey: 'shared_key',
    });
    const aId = (a as { approvalId: Id<'approvals'> }).approvalId;
    const bId = (b as { approvalId: Id<'approvals'> }).approvalId;
    // Each tenant got its OWN record — B did not latch onto A's.
    expect(aId).not.toBe(bId);
    const rows = await approvalsFor(t, 'shared_key');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.organizationId).sort()).toEqual(
      [ORG_A, ORG_B].sort(),
    );

    // Approving A's record must not clear B's, and re-checking each tenant
    // returns only its own decision — both directions.
    await t.run(async (ctx) => {
      await ctx.db.patch(aId, { status: 'executing' });
    });
    const aRetry = await evaluate(t, {
      organizationId: ORG_A,
      source: 'integration',
      resourceKey: 'shared_key',
    });
    expect(aRetry).toEqual({ decision: 'allow', approvalId: aId });
    const bRetry = await evaluate(t, {
      organizationId: ORG_B,
      source: 'integration',
      resourceKey: 'shared_key',
    });
    expect(bRetry).toEqual({ decision: 'needs-approval', approvalId: bId });
  });
});
