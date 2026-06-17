/**
 * convex-test suite for the integration processing-records internal
 * mutations: dedupe + claim semantics, backoff resurfacing, watermark
 * monotonicity and cursor persistence via the sync-state sentinel row.
 */

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../_generated/api';
import schema from '../../schema';
import { SYNC_STATE_RECORD_ID } from './integration_table_name';

// convex-test module map keyed relative to the convex/ root. This file lives
// at convex/workflows/processing_records/, so resolve glob keys against that.
const TEST_DIR_FROM_CONVEX_ROOT = 'workflows/processing_records';
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

const ORG = 'org_int';
const WF = 'wf_def_1';
const TABLE = 'integration:shopify:orders';

const claimMutation =
  internal.workflows.processing_records.internal_mutations
    .claimFirstUnprocessedIntegration;
const recordProcessedMutation =
  internal.workflows.processing_records.internal_mutations
    .recordIntegrationProcessed;
const upsertSyncStateMutation =
  internal.workflows.processing_records.internal_mutations
    .upsertIntegrationSyncState;
const getSyncStateQuery =
  internal.workflows.processing_records.internal_queries
    .getIntegrationSyncState;

function candidate(
  recordId: string,
  incrementalValue?: string | number,
): {
  recordId: string;
  recordCreationTime: number;
  incrementalValue?: string | number;
} {
  return {
    recordId,
    recordCreationTime: Date.now(),
    ...(incrementalValue !== undefined ? { incrementalValue } : {}),
  };
}

const baseClaimArgs = {
  organizationId: ORG,
  tableName: TABLE,
  wfDefinitionId: WF,
  backoffHours: -1,
};

describe('claimFirstUnprocessedIntegration', () => {
  it('claims the first candidate and stores claim metadata', async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates: [candidate('g1', 100), candidate('g2', 200)],
      strategy: 'timestamp_based',
    });

    expect(result).toEqual({ claimedRecordId: 'g1', allProcessed: false });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('workflowProcessingRecords')
        .withIndex('by_record', (q) =>
          q
            .eq('tableName', TABLE)
            .eq('recordId', 'g1')
            .eq('wfDefinitionId', WF),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('in_progress');
    expect(rows[0].organizationId).toBe(ORG);
    expect(rows[0].metadata).toEqual({
      strategy: 'timestamp_based',
      incrementalValue: 100,
    });
  });

  it('dedupes: a second claim over the same page returns the next record', async () => {
    const t = convexTest(schema, modules);
    const candidates = [candidate('g1'), candidate('g2')];

    const first = await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates,
    });
    const second = await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates,
    });
    const third = await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates,
    });

    expect(first.claimedRecordId).toBe('g1');
    expect(second.claimedRecordId).toBe('g2');
    expect(third).toEqual({ claimedRecordId: null, allProcessed: true });
  });

  it('resurfaces records after the backoff window', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates: [candidate('g1')],
    });

    // Age the processing record beyond a 1-hour backoff.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('workflowProcessingRecords')
        .withIndex('by_record', (q) =>
          q
            .eq('tableName', TABLE)
            .eq('recordId', 'g1')
            .eq('wfDefinitionId', WF),
        )
        .first();
      if (!row) throw new Error('expected claim row');
      await ctx.db.patch(row._id, {
        processedAt: Date.now() - 2 * 60 * 60 * 1000,
        status: 'completed',
      });
    });

    const withNeverReprocess = await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates: [candidate('g1')],
      backoffHours: -1,
    });
    expect(withNeverReprocess.claimedRecordId).toBeNull();

    const withBackoff = await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates: [candidate('g1')],
      backoffHours: 1,
    });
    expect(withBackoff.claimedRecordId).toBe('g1');
  });

  it('skips candidates with the reserved sync-state id', async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates: [candidate(SYNC_STATE_RECORD_ID), candidate('g1')],
    });
    expect(result.claimedRecordId).toBe('g1');
  });

  it('rejects non-integration table names', async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(claimMutation, {
        ...baseClaimArgs,
        tableName: 'customers',
        candidates: [candidate('g1')],
      }),
    ).rejects.toThrow(/requires an integration table name/);
  });

  describe('cursor advancement', () => {
    it('advances the cursor only when the page is fully processed', async () => {
      const t = convexTest(schema, modules);

      // Page with an unprocessed record: claim wins, cursor must NOT advance.
      const claimed = await t.mutation(claimMutation, {
        ...baseClaimArgs,
        candidates: [candidate('o1')],
        strategy: 'cursor_based',
        advanceCursorTo: 'cursor-2',
      });
      expect(claimed.claimedRecordId).toBe('o1');
      expect(
        await t.query(getSyncStateQuery, {
          organizationId: ORG,
          tableName: TABLE,
          wfDefinitionId: WF,
        }),
      ).toBeNull();

      // Same page again: everything processed, cursor advances.
      const drained = await t.mutation(claimMutation, {
        ...baseClaimArgs,
        candidates: [candidate('o1')],
        strategy: 'cursor_based',
        advanceCursorTo: 'cursor-2',
      });
      expect(drained).toEqual({ claimedRecordId: null, allProcessed: true });
      expect(
        await t.query(getSyncStateQuery, {
          organizationId: ORG,
          tableName: TABLE,
          wfDefinitionId: WF,
        }),
      ).toEqual({ strategy: 'cursor_based', cursor: 'cursor-2' });
    });
  });
});

describe('recordIntegrationProcessed', () => {
  it('transitions a claim to completed and preserves claim metadata', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(claimMutation, {
      ...baseClaimArgs,
      candidates: [candidate('g1', 100)],
      strategy: 'timestamp_based',
    });

    await t.mutation(recordProcessedMutation, {
      organizationId: ORG,
      tableName: TABLE,
      recordId: 'g1',
      wfDefinitionId: WF,
      metadata: { note: 'done' },
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('workflowProcessingRecords')
        .withIndex('by_record', (q) =>
          q
            .eq('tableName', TABLE)
            .eq('recordId', 'g1')
            .eq('wfDefinitionId', WF),
        )
        .first(),
    );
    expect(row?.status).toBe('completed');
    expect(row?.metadata).toEqual({
      strategy: 'timestamp_based',
      incrementalValue: 100,
      note: 'done',
    });
  });

  it('rejects the reserved sync-state recordId', async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(recordProcessedMutation, {
        organizationId: ORG,
        tableName: TABLE,
        recordId: SYNC_STATE_RECORD_ID,
        wfDefinitionId: WF,
      }),
    ).rejects.toThrow(/reserved/);
  });

  describe('watermark monotonicity', () => {
    async function processWithValue(
      t: ReturnType<typeof convexTest>,
      recordId: string,
      incrementalValue: number,
    ): Promise<void> {
      await t.mutation(claimMutation, {
        ...baseClaimArgs,
        candidates: [candidate(recordId, incrementalValue)],
        strategy: 'timestamp_based',
      });
      await t.mutation(recordProcessedMutation, {
        organizationId: ORG,
        tableName: TABLE,
        recordId,
        wfDefinitionId: WF,
      });
    }

    it('advances on completion and never moves backwards', async () => {
      const t = convexTest(schema, modules);
      const key = {
        organizationId: ORG,
        tableName: TABLE,
        wfDefinitionId: WF,
      };

      await processWithValue(t, 'g1', 100);
      expect(await t.query(getSyncStateQuery, key)).toEqual({
        strategy: 'timestamp_based',
        watermark: 100,
      });

      await processWithValue(t, 'g2', 200);
      expect(await t.query(getSyncStateQuery, key)).toEqual({
        strategy: 'timestamp_based',
        watermark: 200,
      });

      // Out-of-order completion with an older value: watermark stays put.
      await processWithValue(t, 'g3', 50);
      expect(await t.query(getSyncStateQuery, key)).toEqual({
        strategy: 'timestamp_based',
        watermark: 200,
      });
    });

    it('prefers the explicit incrementalValue argument over claim metadata', async () => {
      const t = convexTest(schema, modules);

      await t.mutation(claimMutation, {
        ...baseClaimArgs,
        candidates: [candidate('g1', 100)],
        strategy: 'timestamp_based',
      });
      await t.mutation(recordProcessedMutation, {
        organizationId: ORG,
        tableName: TABLE,
        recordId: 'g1',
        wfDefinitionId: WF,
        incrementalValue: 300,
      });

      expect(
        await t.query(getSyncStateQuery, {
          organizationId: ORG,
          tableName: TABLE,
          wfDefinitionId: WF,
        }),
      ).toEqual({ strategy: 'timestamp_based', watermark: 300 });
    });

    it('does not advance a watermark without a strategy (full_scan/no claim)', async () => {
      const t = convexTest(schema, modules);

      await t.mutation(recordProcessedMutation, {
        organizationId: ORG,
        tableName: TABLE,
        recordId: 'g1',
        wfDefinitionId: WF,
        incrementalValue: 100,
      });

      expect(
        await t.query(getSyncStateQuery, {
          organizationId: ORG,
          tableName: TABLE,
          wfDefinitionId: WF,
        }),
      ).toBeNull();
    });
  });
});

describe('upsertIntegrationSyncState', () => {
  it('creates and replaces the sentinel row wholesale', async () => {
    const t = convexTest(schema, modules);
    const key = { organizationId: ORG, tableName: TABLE, wfDefinitionId: WF };

    await t.mutation(upsertSyncStateMutation, {
      ...key,
      strategy: 'cursor_based',
      cursor: 'abc',
    });
    expect(await t.query(getSyncStateQuery, key)).toEqual({
      strategy: 'cursor_based',
      cursor: 'abc',
    });

    // Replacing without a cursor clears it (stale-cursor recovery).
    await t.mutation(upsertSyncStateMutation, {
      ...key,
      strategy: 'cursor_based',
    });
    expect(await t.query(getSyncStateQuery, key)).toEqual({
      strategy: 'cursor_based',
    });

    // Only one sentinel row exists after repeated upserts.
    const sentinelRows = await t.run(async (ctx) =>
      ctx.db
        .query('workflowProcessingRecords')
        .withIndex('by_record', (q) =>
          q
            .eq('tableName', TABLE)
            .eq('recordId', SYNC_STATE_RECORD_ID)
            .eq('wfDefinitionId', WF),
        )
        .collect(),
    );
    expect(sentinelRows).toHaveLength(1);
  });

  it('scopes sync state per workflow definition', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(upsertSyncStateMutation, {
      organizationId: ORG,
      tableName: TABLE,
      wfDefinitionId: 'wf_a',
      strategy: 'id_based',
      watermark: 10,
    });

    expect(
      await t.query(getSyncStateQuery, {
        organizationId: ORG,
        tableName: TABLE,
        wfDefinitionId: 'wf_b',
      }),
    ).toBeNull();
  });
});
