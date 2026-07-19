import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import schema from '../schema';

/**
 * getChatHealthRollup is the admin Metrics → Chat health read. These tests pin
 * the TENANT-ISOLATION guarantee (the whole point of the instrument — one org's
 * rollup must never read another's rows), the admin gate, and the aggregate
 * math end-to-end through the real query.
 *
 * Identity via withIdentity; org membership via a seeded `memberMirror` row (the
 * RLS local-table fast path) — mirroring tasks/stats.test.ts.
 */

// convex-test module map keyed relative to the convex/ root (file is at
// convex/message_metadata/), mirroring tasks/stats.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'message_metadata';
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

const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';
const ADMIN_A = {
  subject: 'user_admin_a',
  email: 'admin-a@example.com',
  name: 'Admin A',
};
const MEMBER_A = {
  subject: 'user_member_a',
  email: 'member-a@example.com',
  name: 'Member A',
};

type T = TestConvex<typeof schema>;
function newT(): T {
  return convexTest(schema, modules);
}

async function seedMember(
  t: T,
  organizationId: string,
  userId: string,
  role: string,
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('memberMirror', {
      organizationId,
      userId,
      memberId: `member_${userId}`,
      role,
      createdAt: 0,
    }),
  );
}

async function seedMeta(
  t: T,
  organizationId: string,
  rows: Array<Partial<Doc<'messageMetadata'>>>,
): Promise<void> {
  await t.run(async (ctx) => {
    for (const [i, r] of rows.entries()) {
      await ctx.db.insert('messageMetadata', {
        organizationId,
        messageId: `${organizationId}_msg_${i}`,
        threadId: `${organizationId}_thread`,
        model: 'gpt-4o',
        provider: 'openai',
        ...r,
      });
    }
  });
}

describe('getChatHealthRollup', () => {
  it('scopes the rollup to the caller org and never leaks another org', async () => {
    const t = newT();
    await seedMember(t, ORG_A, ADMIN_A.subject, 'admin');

    // Org A: 3 turns, 1 error, durations 100/200/300, model gpt-4o, cost 2+3+5.
    await seedMeta(t, ORG_A, [
      {
        durationMs: 100,
        error: 'boom',
        inputTokens: 10,
        outputTokens: 5,
        costEstimateCents: 2,
        autoRouteReason: 'classified',
        agentSlug: 'researcher',
      },
      {
        durationMs: 200,
        inputTokens: 20,
        outputTokens: 10,
        costEstimateCents: 3,
        agentSlug: 'general',
      },
      {
        durationMs: 300,
        inputTokens: 30,
        outputTokens: 15,
        costEstimateCents: 5,
        autoRouteReason: 'trivial',
        agentSlug: 'general',
      },
    ]);

    // Org B: a DISTINCT signature (own model, 9999ms latency, all errors, huge
    // cost). If any of it leaks into A's rollup, the assertions below break.
    await seedMeta(
      t,
      ORG_B,
      Array.from({ length: 5 }, () => ({
        durationMs: 9999,
        error: 'b-error',
        model: 'model-b',
        provider: 'provider-b',
        costEstimateCents: 100,
      })),
    );

    const res = await t
      .withIdentity(ADMIN_A)
      .query(api.message_metadata.queries.getChatHealthRollup, {
        organizationId: ORG_A,
        periodDays: 7,
      });

    expect(res).not.toBeNull();
    // Only org A's 3 rows — never org B's 5.
    expect(res?.totalMessages).toBe(3);
    expect(res?.errorCount).toBe(1);
    expect(res?.errorRate).toBeCloseTo(1 / 3, 5);
    // Latency percentiles over org A's [100,200,300] only, not B's 9999ms.
    expect(res?.latency.durationMs.p50).toBe(200);
    expect(res?.latency.durationMs.p95).toBe(300);
    // Cost is A's 2+3+5, never +500 from B.
    expect(res?.costCents).toBe(10);
    // Org B's model must be absent; org A's present with A's count.
    expect(res?.routing.byModel.some((m) => m.model === 'model-b')).toBe(false);
    expect(res?.routing.byModel.find((m) => m.model === 'gpt-4o')?.count).toBe(
      3,
    );
    expect(res?.hasAnyData).toBe(true);
    expect(res?.capped).toBe(false);
  });

  it('refuses an admin querying an org they do not belong to', async () => {
    const t = newT();
    await seedMember(t, ORG_A, ADMIN_A.subject, 'admin');
    // Org B has data, but admin-A is not a member of B.
    await seedMeta(t, ORG_B, [{ durationMs: 1 }]);

    // Mirror miss → authoritative Better Auth lookup, absent in convex-test, so
    // only the rejection (never data) can be asserted here — tenant isolation
    // holds: an admin of one org cannot even invoke the rollup for another.
    await expect(
      t
        .withIdentity(ADMIN_A)
        .query(api.message_metadata.queries.getChatHealthRollup, {
          organizationId: ORG_B,
        }),
    ).rejects.toThrow();
  });

  it('refuses a non-admin member', async () => {
    const t = newT();
    await seedMember(t, ORG_A, MEMBER_A.subject, 'member');
    await seedMeta(t, ORG_A, [{ durationMs: 100 }]);

    await expect(
      t
        .withIdentity(MEMBER_A)
        .query(api.message_metadata.queries.getChatHealthRollup, {
          organizationId: ORG_A,
        }),
    ).rejects.toThrow(/admin/i);
  });

  it('returns null when unauthenticated', async () => {
    const t = newT();
    await seedMeta(t, ORG_A, [{ durationMs: 100 }]);

    const res = await t.query(
      api.message_metadata.queries.getChatHealthRollup,
      { organizationId: ORG_A },
    );
    expect(res).toBeNull();
  });

  it('reports hasAnyData=false for an admin org with no telemetry', async () => {
    const t = newT();
    await seedMember(t, ORG_A, ADMIN_A.subject, 'admin');

    const res = await t
      .withIdentity(ADMIN_A)
      .query(api.message_metadata.queries.getChatHealthRollup, {
        organizationId: ORG_A,
      });
    expect(res?.hasAnyData).toBe(false);
    expect(res?.totalMessages).toBe(0);
  });
});
