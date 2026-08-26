/**
 * Task search is a bounded scan over the CALLER'S readable projects — the
 * isolation and the AND-matching are the contract; a regression either leaks
 * another project's work into the palette or floods it with noise.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { taskFieldHaystack } from './search';

const TEST_DIR_FROM_CONVEX_ROOT = 'tasks';
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

const ORG = 'org_task_ui_search';
const OTHER_ORG = 'org_other';
const ALICE = 'user_alice';
const BOB = 'user_bob';

async function seedMember(
  t: T,
  userId: string,
  role = 'member',
  organizationId = ORG,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    });
  });
}

async function seedProject(
  t: T,
  name: string,
  opts?: { key?: string; teamId?: string; organizationId?: string },
): Promise<Id<'projects'>> {
  return t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: opts?.organizationId ?? ORG,
      name,
      key: opts?.key,
      teamId: opts?.teamId,
      createdBy: ALICE,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

async function seedTask(
  t: T,
  projectId: Id<'projects'>,
  fields: {
    title: string;
    description?: string;
    externalId?: string;
    number?: number;
    updatedAt?: number;
    archivedAt?: number;
  },
): Promise<Id<'tasks'>> {
  return t.run((ctx) =>
    ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: fields.title,
      description: fields.description,
      externalId: fields.externalId,
      number: fields.number,
      status: 'todo',
      rank: 'a0',
      createdBy: ALICE,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: fields.updatedAt ?? 1,
      archivedAt: fields.archivedAt,
    }),
  );
}

describe('taskFieldHaystack', () => {
  it('joins title, description, external id, and KEY-number', () => {
    expect(
      taskFieldHaystack(
        {
          title: 'Printer return',
          description: 'Within 30 days',
          externalId: 'acme/repo#12',
          number: 7,
        },
        'TAL',
      ),
    ).toContain('printer return');
    expect(
      taskFieldHaystack(
        {
          title: 'Printer return',
          description: 'Within 30 days',
          externalId: 'acme/repo#12',
          number: 7,
        },
        'TAL',
      ),
    ).toContain('tal-7');
    expect(
      taskFieldHaystack(
        {
          title: 'Printer return',
          description: 'Within 30 days',
          externalId: 'acme/repo#12',
          number: 7,
        },
        'TAL',
      ),
    ).toContain('acme/repo#12');
  });
});

describe('searchTasks', () => {
  it('matches title OR description with every token, newest first', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const projectId = await seedProject(t, 'Launch', { key: 'LCH' });
    const byTitle = await seedTask(t, projectId, {
      title: 'Printer return policy',
      description: 'irrelevant',
      updatedAt: 3,
    });
    const byBody = await seedTask(t, projectId, {
      title: 'untitled-ish',
      description: 'You can return the printer within 30 days.',
      updatedAt: 2,
    });
    await seedTask(t, projectId, {
      title: 'other topic',
      description: 'about invoices',
      updatedAt: 1,
    });

    const hits = await t
      .withIdentity({ subject: ALICE })
      .query(api.tasks.search.searchTasks, {
        organizationId: ORG,
        query: 'printer return',
      });
    expect(hits.map((hit) => hit.taskId).sort()).toEqual(
      [byTitle, byBody].sort(),
    );
    const bodyHit = hits.find((hit) => hit.taskId === byBody);
    expect(bodyHit?.snippet).toContain('within 30 days');
  });

  it('matches externalId and KEY-number identifiers', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const projectId = await seedProject(t, 'Launch', { key: 'LCH' });
    const byExternal = await seedTask(t, projectId, {
      title: 'Synced issue',
      externalId: 'owner/repo#99',
      number: 12,
    });

    const alice = t.withIdentity({ subject: ALICE });
    await expect(
      alice.query(api.tasks.search.searchTasks, {
        organizationId: ORG,
        query: 'owner/repo#99',
      }),
    ).resolves.toEqual([
      expect.objectContaining({ taskId: byExternal, projectKey: 'LCH' }),
    ]);
    await expect(
      alice.query(api.tasks.search.searchTasks, {
        organizationId: ORG,
        query: 'lch-12',
      }),
    ).resolves.toEqual([expect.objectContaining({ taskId: byExternal })]);
  });

  it('respects project scope and skips archived tasks', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const a = await seedProject(t, 'A', { key: 'AAA' });
    const b = await seedProject(t, 'B', { key: 'BBB' });
    const inA = await seedTask(t, a, {
      title: 'Shared token alpha',
      updatedAt: 2,
    });
    await seedTask(t, b, { title: 'Shared token beta', updatedAt: 3 });
    await seedTask(t, a, {
      title: 'Shared token archived',
      archivedAt: 1,
      updatedAt: 4,
    });

    const hits = await t
      .withIdentity({ subject: ALICE })
      .query(api.tasks.search.searchTasks, {
        organizationId: ORG,
        query: 'shared token',
        projectId: a,
      });
    expect(hits.map((hit) => hit.taskId)).toEqual([inA]);
  });

  it('never surfaces tasks from projects the caller cannot read', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, 'member');
    await seedMember(t, BOB, 'member');
    const locked = await seedProject(t, 'Secret', {
      key: 'SEC',
      teamId: 'team_secret',
    });
    await seedTask(t, locked, {
      title: 'secret roadmap',
      description: 'the secret plans',
    });

    const hits = await t
      .withIdentity({ subject: BOB })
      .query(api.tasks.search.searchTasks, {
        organizationId: ORG,
        query: 'secret',
      });
    expect(hits).toEqual([]);
  });

  it('answers nothing for a blank query', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const projectId = await seedProject(t, 'Launch');
    await seedTask(t, projectId, {
      title: 'doomed',
      description: 'doomed text',
    });

    await expect(
      t.withIdentity({ subject: ALICE }).query(api.tasks.search.searchTasks, {
        organizationId: ORG,
        query: '   ',
      }),
    ).resolves.toEqual([]);
  });

  it('does not leak tasks from another organization', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, 'member', ORG);
    await seedMember(t, ALICE, 'member', OTHER_ORG);
    const foreign = await seedProject(t, 'Foreign', {
      organizationId: OTHER_ORG,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('tasks', {
        organizationId: OTHER_ORG,
        projectId: foreign,
        title: 'cross-org leak',
        status: 'todo',
        rank: 'a0',
        createdBy: ALICE,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 1,
      });
    });

    const hits = await t
      .withIdentity({ subject: ALICE })
      .query(api.tasks.search.searchTasks, {
        organizationId: ORG,
        query: 'cross-org',
      });
    expect(hits).toEqual([]);
  });
});
