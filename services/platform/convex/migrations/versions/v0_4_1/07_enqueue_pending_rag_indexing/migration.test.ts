// @vitest-environment node

import { expect, vi } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_1/07_enqueue_pending_rag_indexing';

// The pools are mocked so the enqueues are observable and no component has to
// be registered. What the migration must prove is narrow: a `'queued'` row is
// enqueued, anything else is not, and NO row is written — which is what makes
// the harness's digest-equal `down` pass with a no-op inverse.
const enqueued = vi.hoisted(() => [] as string[]);
vi.mock('../../../../file_metadata/rag_pools', () => {
  const pool = {
    enqueueAction: (
      _ctx: unknown,
      _fn: unknown,
      args: { storageId?: string; expectedFileId?: string },
    ) => {
      enqueued.push(String(args.storageId ?? args.expectedFileId));
      return Promise.resolve('work_test');
    },
  };
  return {
    ragInteractivePool: pool,
    ragBackgroundPool: pool,
    ragPoolFor: () => pool,
  };
});

defineMigrationTest({
  id: '0.4.1/07_enqueue_pending_rag_indexing',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    enqueued.length = 0;
    // Queued, so it must be enqueued.
    await ctx.db.insert('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'blob_queued',
      fileName: 'waiting.pdf',
      contentType: 'application/pdf',
      size: 1024,
      source: 'user',
      ragStatus: 'queued',
    });
    // Queued AND parked — the shape #2986 stranded. Its flag must survive
    // untouched, or `down` could not restore the world byte-for-byte.
    await ctx.db.insert('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'blob_parked',
      fileName: 'stranded.pdf',
      contentType: 'application/pdf',
      size: 2048,
      source: 'google_drive',
      ragStatus: 'queued',
      ragParked: true,
    });
    // Already finished: nothing to enqueue.
    await ctx.db.insert('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'blob_done',
      fileName: 'indexed.pdf',
      contentType: 'application/pdf',
      size: 512,
      source: 'user',
      ragStatus: 'completed',
    });
  },

  async expectUp(world) {
    // Both queued rows enqueued, the completed one not.
    expect([...enqueued].sort()).toEqual(['blob_parked', 'blob_queued']);

    // Nothing was written. The park flag in particular survives: clearing it
    // would be a write this migration would owe a reversal for.
    // The world ctx is loosely typed, so the shape this reads is declared.
    interface RagRow {
      storageId: unknown;
      ragStatus: unknown;
      ragParked: unknown;
    }
    const rows: RagRow[] = await world.run(async (ctx) => {
      const all = await ctx.db.query('fileMetadata').collect();
      return all.map((r: RagRow) => ({
        storageId: r.storageId,
        ragStatus: r.ragStatus,
        ragParked: r.ragParked,
      }));
    });
    const parked = rows.find((r: RagRow) => r.storageId === 'blob_parked');
    expect(parked?.ragParked).toBe(true);
    expect(parked?.ragStatus).toBe('queued');
    expect(
      rows.find((r: RagRow) => r.storageId === 'blob_done')?.ragStatus,
    ).toBe('completed');
  },
});
