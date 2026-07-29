/**
 * Aggregated guardrails stats. These tests pin the counting contract (kind /
 * filter / direction / category breakdowns), the per-day series with the two
 * failure kinds folded into one "errors" band, the window bound, and the
 * admin-only gate `getGuardrailStats` shares with `listRecent`.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { DAY_MS } from '../../lib/shared/metrics-window';
import { api } from '../_generated/api';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'chat_filter_events';
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

const ORG = 'org_guardrail_stats';
const ADMIN = 'user_admin';
const MEMBER = 'user_member';
type T = TestConvex<typeof schema>;

async function seedMembers(t: T): Promise<void> {
  await t.run(async (ctx) => {
    // Membership resolves through the local memberMirror, so seeding it is all
    // the auth gate needs (see convex/chat/messages.test.ts).
    await ctx.db.insert('memberMirror', {
      memberId: 'ba_admin',
      userId: ADMIN,
      organizationId: ORG,
      role: 'admin',
      createdAt: 0,
    });
    await ctx.db.insert('memberMirror', {
      memberId: 'ba_member',
      userId: MEMBER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
  });
}

interface EventSeed {
  filterName: 'pii' | 'chat_filter' | 'moderation_provider';
  direction: 'input' | 'output';
  kind: 'detected' | 'blocked' | 'step_error' | 'circuit_open';
  categoryIds?: string[];
  createdAt: number;
  organizationId?: string;
}

async function seedEvents(t: T, seeds: EventSeed[]): Promise<void> {
  await t.run(async (ctx) => {
    for (const [i, seed] of seeds.entries()) {
      await ctx.db.insert('chatFilterEvents', {
        organizationId: seed.organizationId ?? ORG,
        sanitizationRunId: `run_${i}`,
        threadId: `thread_${i}`,
        filterName: seed.filterName,
        direction: seed.direction,
        kind: seed.kind,
        categoryIds: seed.categoryIds ?? [],
        createdAt: seed.createdAt,
      });
    }
  });
}

describe('getGuardrailStats', () => {
  it('counts kinds, filters, directions, categories, and the daily series in-window', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    await seedEvents(t, [
      // Out of the 7-day window — must not be counted.
      {
        filterName: 'pii',
        direction: 'input',
        kind: 'blocked',
        createdAt: now - 9 * DAY_MS,
      },
      // Another org's event — never selected.
      {
        filterName: 'pii',
        direction: 'input',
        kind: 'detected',
        createdAt: now - hour,
        organizationId: 'org_other',
      },
      {
        filterName: 'pii',
        direction: 'input',
        kind: 'detected',
        categoryIds: ['email', 'phone'],
        createdAt: now - 5 * hour,
      },
      {
        filterName: 'pii',
        direction: 'output',
        kind: 'detected',
        categoryIds: ['email'],
        createdAt: now - 4 * hour,
      },
      {
        filterName: 'chat_filter',
        direction: 'input',
        kind: 'blocked',
        categoryIds: ['profanity'],
        createdAt: now - 3 * hour,
      },
      {
        filterName: 'moderation_provider',
        direction: 'input',
        kind: 'step_error',
        createdAt: now - 2 * hour,
      },
      {
        filterName: 'moderation_provider',
        direction: 'input',
        kind: 'circuit_open',
        createdAt: now - hour,
      },
    ]);

    const result = await t
      .withIdentity({ subject: ADMIN })
      .query(api.chat_filter_events.queries.getGuardrailStats, {
        organizationId: ORG,
        periodDays: 7,
      });

    expect(result.byKind).toEqual([
      { key: 'detected', count: 2 },
      // Ties keep first-seen (newest-first walk) order.
      { key: 'circuit_open', count: 1 },
      { key: 'step_error', count: 1 },
      { key: 'blocked', count: 1 },
    ]);
    expect(result.byFilter).toEqual([
      { key: 'moderation_provider', count: 2 },
      { key: 'pii', count: 2 },
      { key: 'chat_filter', count: 1 },
    ]);
    expect(result.byDirection).toEqual([
      { key: 'input', count: 4 },
      { key: 'output', count: 1 },
    ]);
    expect(result.byCategory).toEqual([
      { key: 'email', count: 2 },
      { key: 'profanity', count: 1 },
      { key: 'phone', count: 1 },
    ]);

    expect(result.series).toHaveLength(7);
    const sum = result.series.reduce(
      (acc, point) => ({
        detected: acc.detected + point.detected,
        blocked: acc.blocked + point.blocked,
        errors: acc.errors + point.errors,
      }),
      { detected: 0, blocked: 0, errors: 0 },
    );
    // step_error + circuit_open fold into the series' errors band.
    expect(sum).toEqual({ detected: 2, blocked: 1, errors: 2 });
    expect(result.capped).toBe(false);
  });

  it('refuses non-admin members and unauthenticated callers', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);

    await expect(
      t
        .withIdentity({ subject: MEMBER })
        .query(api.chat_filter_events.queries.getGuardrailStats, {
          organizationId: ORG,
          periodDays: 7,
        }),
    ).rejects.toThrow(/Only admins/);

    await expect(
      t.query(api.chat_filter_events.queries.getGuardrailStats, {
        organizationId: ORG,
        periodDays: 7,
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});
