// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/21_drop_external_runs';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/21_drop_external_runs',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('externalRuns', {
      organizationId: 'org_0',
      taskId: 'task-1',
      projectId: 'project-1',
      agentSlug: 'assistant',
      adapterType: 'claude-code',
      permissionMode: 'safe',
      kind: 'initial',
      trigger: 'assignment',
      prompt: 'Resolve the assigned task.',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      createdAt: 1_717_000_100_000,
      dispatchDeadlineAt: 1_717_000_400_000,
    });
    await ctx.db.insert('externalRuns', {
      organizationId: 'org_1',
      taskId: 'task-2',
      projectId: 'project-2',
      agentSlug: 'writer',
      adapterType: 'codex',
      daemonId: 'daemon-2',
      permissionMode: 'full_auto',
      kind: 'revision',
      trigger: 'revision',
      prompt: 'Apply the requested changes.',
      status: 'completed',
      attempts: 1,
      maxAttempts: 3,
      runId: 'run-2',
      resultSummary: 'Done.',
      createdAt: 1_717_000_200_000,
      dispatchDeadlineAt: 1_717_000_500_000,
      completedAt: 1_717_000_260_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('externalRuns').collect(),
    );
    expect(rows).toHaveLength(0);

    // One snapshot per deleted row, carrying the full legacy payload.
    const snaps = await world.run(
      async (ctx) =>
        (await ctx.db
          .query('migrationSnapshots')
          .withIndex(
            'by_migration',
            (q: { eq: (f: string, v: string) => unknown }) =>
              q.eq('migrationId', world.meta.id),
          )
          .collect()) as Array<Record<string, unknown>>,
    );
    expect(snaps).toHaveLength(2);
    expect(
      snaps.map((s) => (s.payload as { taskId: string }).taskId).sort(),
    ).toEqual(['task-1', 'task-2']);
  },
});
