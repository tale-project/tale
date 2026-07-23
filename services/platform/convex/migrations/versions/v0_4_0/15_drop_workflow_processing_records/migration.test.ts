// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/15_drop_workflow_processing_records';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/15_drop_workflow_processing_records',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('workflowProcessingRecords', {
      organizationId: 'org_0',
      tableName: 'tasks',
      recordId: 'task-100',
      wfDefinitionId: 'projects/tasks/triage-unassigned-tasks',
      recordCreationTime: 1_717_000_050_000,
      processedAt: 1_717_000_100_000,
      status: 'completed',
      metadata: { note: 'first pass' },
    });
    await ctx.db.insert('workflowProcessingRecords', {
      organizationId: 'org_1',
      tableName: 'documents',
      recordId: 'doc-200',
      wfDefinitionId: 'projects/docs/index',
      recordCreationTime: 1_717_000_150_000,
      processedAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('workflowProcessingRecords').collect(),
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
      snaps.map((s) => (s.payload as { recordId: string }).recordId).sort(),
    ).toEqual(['doc-200', 'task-100']);
  },
});
