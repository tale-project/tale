/**
 * Project-shared conversations: the ONE read-grant beside share links. These
 * pin the partition (mine vs shared), the read grant's exact reach (read the
 * messages, never write), and that an unshared conversation stays private to
 * its owner even inside the project.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import schema from '../schema';

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

type T = TestConvex<typeof schema>;

const ORG = 'org_a';
const ALICE = 'user_alice';
const BOB = 'user_bob';

async function seedMember(t: T, userId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${ORG}`,
      userId,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
  });
}

/** An org-wide project (no team restriction) every member can access. */
async function seedProject(t: T): Promise<string> {
  return await t.run(async (ctx) =>
    String(
      await ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Website revamp',
        createdBy: ALICE,
        createdAt: 1,
        updatedAt: 1,
      }),
    ),
  );
}

async function seedProjectThread(
  t: T,
  userId: string,
  projectId: string,
  title: string,
): Promise<string> {
  const threadId = await t
    .withIdentity({ subject: userId })
    .mutation(api.chat.threads.createThread, {
      organizationId: ORG,
      kind: 'direct',
      title,
      projectId,
    });
  await t.run(async (ctx) => {
    await ctx.db.insert('messages', {
      organizationId: ORG,
      threadId,
      role: 'assistant',
      parts: [{ type: 'text', text: `${title} reply` }],
      sequence: 0,
      createdAt: 1,
    });
  });
  return threadId;
}

describe('project-shared chat threads', () => {
  it('partitions mine vs shared, and the grant is read-only', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    await seedMember(t, BOB);
    const projectId = await seedProject(t);
    const aliceShared = await seedProjectThread(t, ALICE, projectId, 'open');
    await seedProjectThread(t, ALICE, projectId, 'private');
    const alice = t.withIdentity({ subject: ALICE });
    const bob = t.withIdentity({ subject: BOB });

    await expect(
      alice.mutation(api.chat.threads.setThreadSharedWithProject, {
        organizationId: ORG,
        threadId: aliceShared,
        shared: true,
      }),
    ).resolves.toBe(true);

    // Alice's view: both under "mine".
    const forAlice = await alice.query(
      api.chat.project_threads.listThreadsForProject,
      { organizationId: ORG, projectId },
    );
    expect(
      forAlice.mine
        .map((row) => String(row.title))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['open', 'private']);
    expect(forAlice.shared).toEqual([]);

    // Bob's view: only the shared one, under "shared".
    const forBob = await bob.query(
      api.chat.project_threads.listThreadsForProject,
      { organizationId: ORG, projectId },
    );
    expect(forBob.mine).toEqual([]);
    expect(forBob.shared.map((row) => row.title)).toEqual(['open']);

    // The grant reaches the messages…
    const readable = await bob.query(api.chat.messages.listMessages, {
      organizationId: ORG,
      threadId: aliceShared,
    });
    expect(readable).toHaveLength(1);
    // …marks the viewer as non-owner…
    const summary = await bob.query(api.chat.threads.getThread, {
      organizationId: ORG,
      threadId: aliceShared,
    });
    expect(summary?.viewerIsOwner).toBe(false);
    // …and never covers writes.
    await expect(
      bob.mutation(api.chat.threads.renameThread, {
        organizationId: ORG,
        threadId: aliceShared,
        title: 'stolen',
      }),
    ).resolves.toBe(false);
  });

  it('keeps unshared project threads private', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    await seedMember(t, BOB);
    const projectId = await seedProject(t);
    const privateThread = await seedProjectThread(
      t,
      ALICE,
      projectId,
      'private',
    );
    const bob = t.withIdentity({ subject: BOB });

    await expect(
      bob.query(api.chat.messages.listMessages, {
        organizationId: ORG,
        threadId: privateThread,
      }),
    ).resolves.toEqual([]);
    await expect(
      bob.query(api.chat.threads.getThread, {
        organizationId: ORG,
        threadId: privateThread,
      }),
    ).resolves.toBeNull();
  });

  it('refuses to share a thread outside any project', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const alice = t.withIdentity({ subject: ALICE });
    const looseThread = await alice.mutation(api.chat.threads.createThread, {
      organizationId: ORG,
      kind: 'direct',
      title: 'loose',
    });

    await expect(
      alice.mutation(api.chat.threads.setThreadSharedWithProject, {
        organizationId: ORG,
        threadId: looseThread,
        shared: true,
      }),
    ).rejects.toThrow();
  });
});
