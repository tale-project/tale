/**
 * The voice-mode cascade: org veto → thread override → user default →
 * false. The composer checkbox and the auto-voice chunker both drive off
 * `getVoiceModeEffective`, so a precedence regression here either mutes
 * voice for someone who asked for it or — worse — auto-plays audio the
 * admin explicitly vetoed. The truth table below pins every rung.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'tts';
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

type T = TestConvex<typeof schema>;

const ORG_A = 'org_a';
const ALICE = 'user_alice';
const BOB = 'user_bob';

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role: 'member',
      createdAt: 0,
    });
  });
}

async function createThread(t: T, userId: string): Promise<string> {
  return t
    .withIdentity({ subject: userId })
    .mutation(api.chat.threads.createThread, {
      organizationId: ORG_A,
      kind: 'direct',
      title: 'Voice thread',
    });
}

async function setUserDefault(
  t: T,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await t
    .withIdentity({ subject: userId })
    .mutation(api.tts.mutations.setUserVoiceOutput, {
      organizationId: ORG_A,
      enabled,
    });
}

async function effective(t: T, userId: string, threadId?: string) {
  return t
    .withIdentity({ subject: userId })
    .query(api.tts.queries.getVoiceModeEffective, {
      organizationId: ORG_A,
      ...(threadId !== undefined ? { threadId } : {}),
    });
}

describe('getVoiceModeEffective — cascade', () => {
  it('defaults to off for a user with no preferences', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    expect(await effective(t, ALICE)).toEqual({
      enabled: false,
      userDefault: false,
      source: 'default',
    });
  });

  it('follows the user default and lets a thread override beat it both ways', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);

    await setUserDefault(t, ALICE, true);
    expect(await effective(t, ALICE, threadId)).toEqual({
      enabled: true,
      userDefault: true,
      source: 'preferences',
    });

    // Override OFF on a master-ON user: the thread stays silent.
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.tts.mutations.setThreadVoiceOutputOverride, {
        threadId,
        organizationId: ORG_A,
        override: false,
      });
    expect(await effective(t, ALICE, threadId)).toEqual({
      enabled: false,
      userDefault: true,
      source: 'thread',
    });

    // Override ON on a master-OFF user: this one conversation speaks.
    await setUserDefault(t, ALICE, false);
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.tts.mutations.setThreadVoiceOutputOverride, {
        threadId,
        organizationId: ORG_A,
        override: true,
      });
    expect(await effective(t, ALICE, threadId)).toEqual({
      enabled: true,
      userDefault: false,
      source: 'thread',
    });
  });

  it('lets the org policy veto every user and thread setting', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    await setUserDefault(t, ALICE, true);
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.tts.mutations.setThreadVoiceOutputOverride, {
        threadId,
        organizationId: ORG_A,
        override: true,
      });

    await t.run(async (ctx) => {
      await ctx.db.insert('configCache', {
        organizationId: ORG_A,
        domain: 'governance',
        key: 'voice_output',
        config: { enabled: false },
        syncedAt: 0,
      });
    });

    expect(await effective(t, ALICE, threadId)).toEqual({
      enabled: false,
      userDefault: false,
      source: 'org_policy',
    });
  });

  it("ignores another user's thread override instead of leaking it", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    const threadId = await createThread(t, ALICE);
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.tts.mutations.setThreadVoiceOutputOverride, {
        threadId,
        organizationId: ORG_A,
        override: true,
      });

    // Bob passing Alice's threadId falls through to his own default.
    expect(await effective(t, BOB, threadId)).toEqual({
      enabled: false,
      userDefault: false,
      source: 'default',
    });
  });
});
