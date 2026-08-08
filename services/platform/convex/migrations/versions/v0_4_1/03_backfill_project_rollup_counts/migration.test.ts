// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_1/03_backfill_project_rollup_counts';

const T = 1_700_000_000_000;

async function seedRollupWorld(
  ctx: {
    // oxlint-disable-next-line typescript/no-explicit-any -- convex-test world db
    db: any;
  },
  organizationId: string,
): Promise<void> {
  // Project A — one task in every bucket the counter cares about, plus two
  // agents, so `up` has to discriminate rather than just count rows.
  const counted: string = await ctx.db.insert('projects', {
    organizationId,
    name: 'Counted',
    createdBy: 'user_seed',
    createdAt: T,
    updatedAt: T,
  });
  const rows: Array<{ status: string; archivedAt?: number }> = [
    { status: 'backlog' },
    { status: 'in_progress' },
    { status: 'in_review' },
    { status: 'done' },
    // Neither bucket: cancelled work never inflates the progress denominator.
    { status: 'cancelled' },
    // Archived beats status — including an archived `done`.
    { status: 'todo', archivedAt: T + 50 },
    { status: 'done', archivedAt: T + 50 },
  ];
  let rank = 0;
  for (const row of rows) {
    await ctx.db.insert('tasks', {
      organizationId,
      projectId: counted,
      title: `Task ${rank}`,
      status: row.status,
      rank: `a${rank}`,
      createdBy: 'user_seed',
      createdByType: 'user',
      createdAt: T,
      updatedAt: T,
      ...(row.archivedAt !== undefined ? { archivedAt: row.archivedAt } : {}),
    });
    rank += 1;
  }
  for (const name of ['Writer', 'Reviewer']) {
    await ctx.db.insert('projectAgents', {
      organizationId,
      projectId: counted,
      name,
      harness: 'claude-code',
      model: 'claude-sonnet-5',
      skills: [],
      connectors: [],
      createdBy: 'user_seed',
      createdAt: T,
      updatedAt: T,
    });
  }

  // Project B — the edge row: nothing at all. Must come out as explicit zeros,
  // not left undefined, so it matches what `createProject` writes.
  await ctx.db.insert('projects', {
    organizationId,
    name: 'Empty',
    createdBy: 'user_seed',
    createdAt: T,
    updatedAt: T,
  });
}

// The harness runs the full ritual automatically: up through the real runner,
// TRUE handler idempotency over migrated state, digest-equal down (the seeded
// world must come back byte-for-byte), ledger transitions, snapshot hygiene,
// and the destructive gate. This file provides DATA + migration-specific truth.
defineMigrationTest({
  id: '0.4.1/03_backfill_project_rollup_counts',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx, orgs) {
    const org = orgs[0];
    if (!org) throw new Error('harness seeded no org');
    await seedRollupWorld(ctx, org.id);
  },

  async expectUp(world) {
    const { projects } = await world.run(async (ctx) => ({
      projects: await ctx.db.query('projects').collect(),
    }));

    const counted = projects.find(
      (p: { name: string }) => p.name === 'Counted',
    );
    expect(counted).toMatchObject({
      // backlog + in_progress + in_review = 3; the archived todo is excluded.
      openTaskCount: 3,
      // The one live `done`; the archived `done` and the cancelled row are not.
      doneTaskCount: 1,
      projectAgentCount: 2,
    });

    const empty = projects.find((p: { name: string }) => p.name === 'Empty');
    expect(empty).toMatchObject({
      openTaskCount: 0,
      doneTaskCount: 0,
      projectAgentCount: 0,
    });
  },

  cases: {
    'leaves a project whose counters already agree untouched': async (
      world,
    ) => {
      await world.run(async (ctx) => {
        const projects = await ctx.db.query('projects').collect();
        const counted = projects.find(
          (p: { name: string }) => p.name === 'Counted',
        );
        if (!counted) throw new Error('seed missing the Counted project');
        await ctx.db.patch(counted._id, {
          openTaskCount: 3,
          doneTaskCount: 1,
          projectAgentCount: 2,
        });
      });

      await world.applyUpOnly();

      const { projects } = await world.run(async (ctx) => ({
        projects: await ctx.db.query('projects').collect(),
      }));
      const counted = projects.find(
        (p: { name: string }) => p.name === 'Counted',
      );
      expect(counted).toMatchObject({
        openTaskCount: 3,
        doneTaskCount: 1,
        projectAgentCount: 2,
      });
    },
  },
});
