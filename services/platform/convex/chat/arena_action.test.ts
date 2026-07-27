/**
 * The arena fan-out's isolation contract: one column's failure — even a
 * pre-pipeline throw with no store to write through — records an assistant
 * error row on ITS thread and leaves the other column's result intact. A
 * dead model must never blank the comparison.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { api, components } from '../_generated/api';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

const executeTurnMock = vi.fn();
vi.mock('./turn_action', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    executeTurn: (...args: unknown[]) => executeTurnMock(...(args as [])),
  };
});

const TEST_DIR_FROM_CONVEX_ROOT = 'chat';
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
const authModules = import.meta.glob('../betterAuth/**/*.*s');

type T = TestConvex<typeof schema>;

const ALICE = 'user_alice';

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

/** A betterAuth org + membership + mirror row — the action's membership gate
 * reads the adapter; the mutations read the mirror. */
async function seedOrgWithMember(t: T, userId: string): Promise<string> {
  return t.run(async (ctx) => {
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'organization',
          data: { name: 'arena-org', slug: 'arena-org', createdAt: 0 },
        },
      },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter returns the created record as unknown
    const organizationId = (created as { _id: string })._id;
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'member',
        data: { organizationId, userId, role: 'member', createdAt: 0 },
      },
    });
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId,
      role: 'member',
      createdAt: 0,
    });
    return organizationId;
  });
}

describe('startArenaTurn — fan-out isolation', () => {
  it('one dead model records its error row while the other column completes', async () => {
    const t = newWorld();
    const organizationId = await seedOrgWithMember(t, ALICE);
    const asAlice = t.withIdentity({ subject: ALICE });

    const threadId = await asAlice.mutation(api.chat.threads.createThread, {
      organizationId,
      kind: 'direct',
      title: 'Fan-out',
    });
    const paired = await asAlice.mutation(api.chat.arena.ensureArenaPair, {
      organizationId,
      threadId,
    });
    if (!('threadIdB' in paired) || paired.threadIdB === undefined) {
      throw new Error(`pairing refused: ${JSON.stringify(paired)}`);
    }
    const threadIdB = paired.threadIdB;

    executeTurnMock.mockImplementation(
      async (_ctx: unknown, args: { modelId: string }) => {
        if (args.modelId === 'model-broken') {
          throw new Error('provider exploded');
        }
        return { status: 'completed', steps: [] };
      },
    );

    const result = await asAlice.action(api.chat.arena_action.startArenaTurn, {
      organizationId,
      threadId,
      userText: 'Race!',
      modelIdA: 'model-ok',
      modelIdB: 'model-broken',
    });
    expect(result.a).toEqual({ status: 'completed' });
    expect(result.b.status).toBe('refused');

    // The dead column explains itself: an assistant error row on B, nothing
    // on A (the mock wrote no rows for the healthy side).
    const rowsB = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadIdB))
        .collect(),
    );
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.role).toBe('assistant');
    expect(rowsB[0]?.model).toBe('model-broken');
    expect(rowsB[0]?.error).toBeDefined();
  });

  it('refuses both sides while either column is generating, without running a turn', async () => {
    const t = newWorld();
    const organizationId = await seedOrgWithMember(t, ALICE);
    const asAlice = t.withIdentity({ subject: ALICE });

    const threadId = await asAlice.mutation(api.chat.threads.createThread, {
      organizationId,
      kind: 'direct',
    });
    const paired = await asAlice.mutation(api.chat.arena.ensureArenaPair, {
      organizationId,
      threadId,
    });
    if (!('threadIdB' in paired) || paired.threadIdB === undefined) {
      throw new Error(`pairing refused: ${JSON.stringify(paired)}`);
    }

    await t.run(async (ctx) => {
      await ctx.db.insert('generations', {
        organizationId,
        threadId: paired.threadIdB,
        status: 'streaming',
        streamId: 'stream-busy',
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      });
    });

    executeTurnMock.mockClear();
    const result = await asAlice.action(api.chat.arena_action.startArenaTurn, {
      organizationId,
      threadId,
      userText: 'Race!',
      modelIdA: 'model-ok',
      modelIdB: 'model-ok',
    });
    expect(result.a.status).toBe('refused');
    expect(result.b.status).toBe('refused');
    expect(executeTurnMock).not.toHaveBeenCalled();
  });
});
