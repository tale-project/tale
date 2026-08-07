// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_1/02_task_labels_to_catalog';

async function seedLabelWorld(
  ctx: {
    // oxlint-disable-next-line typescript/no-explicit-any -- convex-test world db
    db: any;
  },
  organizationId: string,
): Promise<void> {
  const projectId: string = await ctx.db.insert('projects', {
    organizationId,
    name: 'Label board',
    createdBy: 'user_seed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    taskLabelColors: { custom: 'teal' },
  });
  await ctx.db.insert('tasks', {
    organizationId,
    projectId,
    title: 'Fix crash',
    status: 'todo',
    // Alphabetical so down's sorted restore matches the seed digest.
    labels: ['bug', 'custom'],
    rank: 'a0',
    createdBy: 'user_seed',
    createdByType: 'user',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  });
  await ctx.db.insert('tasks', {
    organizationId,
    projectId,
    title: 'Unlabelled',
    status: 'backlog',
    rank: 'a1',
    createdBy: 'user_seed',
    createdByType: 'user',
    createdAt: 1_700_000_000_001,
    updatedAt: 1_700_000_000_001,
  });
}

defineMigrationTest({
  id: '0.4.1/02_task_labels_to_catalog',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx, orgs) {
    const org = orgs[0];
    if (!org) throw new Error('harness seeded no org');
    await seedLabelWorld(ctx, org.id);
  },

  async expectUp(world) {
    const { labels, tasks, projects } = await world.run(async (ctx) => ({
      labels: await ctx.db.query('taskLabels').collect(),
      tasks: await ctx.db.query('tasks').collect(),
      projects: await ctx.db.query('projects').collect(),
    }));
    expect(labels).toHaveLength(4);
    const byName = Object.fromEntries(
      labels.map((l: { name: string; color: string }) => [l.name, l]),
    );
    expect(byName.bug).toMatchObject({ color: 'red' });
    expect(byName.feature).toMatchObject({ color: 'purple' });
    expect(byName.improvement).toMatchObject({ color: 'blue' });
    expect(byName.custom).toMatchObject({ color: 'teal' });
    for (const project of projects) {
      expect(project.taskLabelColors).toBeUndefined();
    }
    const labelled = tasks.find(
      (t: { title: string }) => t.title === 'Fix crash',
    );
    expect(labelled?.labels).toBeUndefined();
    expect(labelled?.labelIds).toHaveLength(2);
    const bare = tasks.find((t: { title: string }) => t.title === 'Unlabelled');
    expect(bare?.labelIds).toBeUndefined();
    expect(bare?.labels).toBeUndefined();
  },
});
