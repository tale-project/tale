import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import schema from '../../schema';
import { __test } from './internal_actions';
import { isReusableThreadMeta } from './internal_mutations';

// convex-test needs a module map keyed relative to the convex/ root. This file
// lives at convex/integrations/slack/, so glob from two levels up and strip the
// leading '../../' so e.g. internal.integrations.slack_installations resolves.
// convex-test needs a module map keyed relative to the convex/ root. Vite
// returns glob keys relative to THIS file's dir (convex/integrations/slack/)
// with collapsed `../` depth, so resolve each against that base to recover a
// convex-root-relative path (e.g. `integrations/slack/internal_mutations.ts`).
const TEST_DIR_FROM_CONVEX_ROOT = 'integrations/slack';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

const rawModules = import.meta.glob('../../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG_A = 'org_a';
const ORG_B = 'org_b';

async function seedSlackCredential(
  t: ReturnType<typeof convexTest>,
  organizationId: string,
): Promise<Id<'integrationCredentials'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('integrationCredentials', {
      organizationId,
      slug: 'slack',
      status: 'active',
      isActive: true,
      authMethod: 'oauth2',
    }),
  );
}

describe('slack installations routing', () => {
  it('upserts a workspace and resolves the org by team_id', async () => {
    const t = convexTest(schema, modules);
    const credentialId = await seedSlackCredential(t, ORG_A);

    await t.mutation(
      internal.integrations.slack_installations.upsertInstallation,
      {
        teamId: 'T123',
        organizationId: ORG_A,
        slug: 'slack',
        botUserId: 'UBOT',
        credentialId,
      },
    );

    const route = await t.query(
      internal.integrations.slack_installations.resolveOrgBySlackTeamId,
      { teamId: 'T123' },
    );
    expect(route?.organizationId).toBe(ORG_A);
    expect(route?.botUserId).toBe('UBOT');
  });

  it('re-install by the same org patches in place', async () => {
    const t = convexTest(schema, modules);
    const credentialId = await seedSlackCredential(t, ORG_A);

    await t.mutation(
      internal.integrations.slack_installations.upsertInstallation,
      {
        teamId: 'T1',
        organizationId: ORG_A,
        slug: 'slack',
        botUserId: 'U1',
        credentialId,
      },
    );
    await t.mutation(
      internal.integrations.slack_installations.upsertInstallation,
      {
        teamId: 'T1',
        organizationId: ORG_A,
        slug: 'slack',
        botUserId: 'U2',
        credentialId,
      },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db.query('slackInstallations').collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].botUserId).toBe('U2');
  });

  it('rejects a different org claiming an already-mapped workspace', async () => {
    const t = convexTest(schema, modules);
    const credA = await seedSlackCredential(t, ORG_A);
    const credB = await seedSlackCredential(t, ORG_B);

    await t.mutation(
      internal.integrations.slack_installations.upsertInstallation,
      {
        teamId: 'Tshared',
        organizationId: ORG_A,
        slug: 'slack',
        credentialId: credA,
      },
    );

    await expect(
      t.mutation(internal.integrations.slack_installations.upsertInstallation, {
        teamId: 'Tshared',
        organizationId: ORG_B,
        slug: 'slack',
        credentialId: credB,
      }),
    ).rejects.toThrow(/already connected to another organization/);
  });

  it('resolves null for an unknown workspace', async () => {
    const t = convexTest(schema, modules);
    const route = await t.query(
      internal.integrations.slack_installations.resolveOrgBySlackTeamId,
      { teamId: 'nope' },
    );
    expect(route).toBeNull();
  });
});

describe('slack event dedup', () => {
  it('claims an event once; a retry is dropped', async () => {
    const t = convexTest(schema, modules);

    const first = await t.mutation(
      internal.integrations.slack.internal_mutations.claimSlackEvent,
      { eventId: 'Ev123' },
    );
    const second = await t.mutation(
      internal.integrations.slack.internal_mutations.claimSlackEvent,
      { eventId: 'Ev123' },
    );

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
  });
});

describe('getOrCreateSlackThread (dangling/tombstone guard)', () => {
  // Seed a Slack-conversation → threadId mapping plus its threadMetadata row.
  async function seedMapping(
    t: ReturnType<typeof convexTest>,
    threadId: string,
    status: 'active' | 'trashed',
  ): Promise<void> {
    await t.run(async (ctx) => {
      await ctx.db.insert('slackThreads', {
        organizationId: ORG_A,
        channel: 'C1',
        conversationTs: '100.0001',
        threadId,
        slackUserId: 'U1',
        createdAt: 1,
      });
      await ctx.db.insert('threadMetadata', {
        threadId,
        userId: `slack:${ORG_A}:U1`,
        chatType: 'general',
        status,
        createdAt: 1,
      });
    });
  }

  it('reuses the mapped thread when it is still active', async () => {
    const t = convexTest(schema, modules);
    await seedMapping(t, 'thread_active', 'active');

    const res = await t.mutation(
      internal.integrations.slack.internal_mutations.getOrCreateSlackThread,
      {
        organizationId: ORG_A,
        channel: 'C1',
        conversationTs: '100.0001',
        slackUserId: 'U1',
      },
    );

    expect(res).toEqual({ threadId: 'thread_active', created: false });
    // The mapping is untouched — no stale-row drop, no re-provision.
    const rows = await t.run(async (ctx) =>
      ctx.db.query('slackThreads').collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].threadId).toBe('thread_active');
  });

  // The trashed → re-provision branch drops the stale mapping and calls
  // `createChatThread`, which goes through the `@convex-dev/agent` component
  // that convex-test does not register — so it can't be asserted end-to-end
  // here. The reuse DECISION is the bug fix; it is extracted into the pure
  // `isReusableThreadMeta` predicate and unit-tested across all statuses below.
  // The user-facing path is additionally covered by the delete_chat_thread
  // cascade (which removes the mapping at trash time so a trashed thread is
  // never reached); this guard is the defense-in-depth backstop.
});

describe('isReusableThreadMeta (slack thread reuse guard)', () => {
  it('reuses only an active thread', () => {
    expect(isReusableThreadMeta({ status: 'active' })).toBe(true);
  });

  it('does NOT reuse a soft-deleted, expired, deleted, or archived thread', () => {
    for (const status of ['trashed', 'expired', 'deleted', 'archived']) {
      expect(isReusableThreadMeta({ status })).toBe(false);
    }
  });

  it('does NOT reuse a physically purged (missing) thread', () => {
    expect(isReusableThreadMeta(null)).toBe(false);
    expect(isReusableThreadMeta(undefined)).toBe(false);
  });
});

describe('awaitStreamSettle (liveness grace re-poll)', () => {
  const noSleep = async () => {};
  function bodySeq(seq: Array<{ status: string; text: string }>) {
    let i = 0;
    return async () => seq[Math.min(i++, seq.length - 1)];
  }

  it('returns the real text when the stream finalizes within the grace window', async () => {
    // Models the race: status flips to idle, then the stream commits 'done' a
    // couple of polls later. We must surface the real answer, not the fallback.
    const getBody = bodySeq([
      { status: 'streaming', text: '' },
      { status: 'streaming', text: 'partial' },
      { status: 'done', text: 'final answer' },
    ]);
    const settled = await __test.awaitStreamSettle(getBody, noSleep, {
      gracePolls: 20,
      intervalMs: 1,
    });
    expect(settled).toBe('final answer');
  });

  it('returns undefined when the stream errors (keep fallback)', async () => {
    const getBody = bodySeq([{ status: 'error', text: '' }]);
    const settled = await __test.awaitStreamSettle(getBody, noSleep, {
      gracePolls: 20,
      intervalMs: 1,
    });
    expect(settled).toBeUndefined();
  });

  it('returns undefined when the stream never finalizes within the window', async () => {
    // Genuine short-circuit (e.g. budget block): stream never terminalizes.
    let calls = 0;
    const getBody = async () => {
      calls++;
      return { status: 'streaming', text: '' };
    };
    const settled = await __test.awaitStreamSettle(getBody, noSleep, {
      gracePolls: 3,
      intervalMs: 1,
    });
    expect(settled).toBeUndefined();
    expect(calls).toBe(3);
  });

  it('treats a done-but-empty stream as no reply (fallback)', async () => {
    const getBody = bodySeq([{ status: 'done', text: '' }]);
    const settled = await __test.awaitStreamSettle(getBody, noSleep, {
      gracePolls: 5,
      intervalMs: 1,
    });
    expect(settled).toBeUndefined();
  });
});

describe('deriveThreadKeys', () => {
  const { deriveThreadKeys } = __test;

  it('channel mention without a thread keys on (and replies under) the message ts', () => {
    expect(deriveThreadKeys('app_mention', undefined, '111.0001')).toEqual({
      threadKey: '111.0001',
      replyThreadTs: '111.0001',
    });
  });

  it('channel mention inside a thread keys on (and replies under) the thread root', () => {
    expect(deriveThreadKeys('app_mention', '111.0000', '111.0009')).toEqual({
      threadKey: '111.0000',
      replyThreadTs: '111.0000',
    });
  });

  it('top-level DM (no thread_ts) keys on the stable sentinel and replies top-level', () => {
    // The bug this fixes: a per-message messageTs key minted a new Tale thread
    // every DM turn. The sentinel keeps all DM turns on one continuous thread,
    // and an undefined replyThreadTs posts a normal (non-nested) DM reply.
    const a = deriveThreadKeys('message_im', undefined, '222.0001');
    const b = deriveThreadKeys('message_im', undefined, '222.0002');
    expect(a).toEqual({ threadKey: 'im', replyThreadTs: undefined });
    expect(b.threadKey).toBe(a.threadKey); // same thread across turns
  });

  it('DM that carries an explicit thread_ts preserves it for the reply', () => {
    expect(deriveThreadKeys('message_im', '222.0000', '222.0005')).toEqual({
      threadKey: 'im',
      replyThreadTs: '222.0000',
    });
  });
});
