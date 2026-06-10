/**
 * Orchestration tests for findUnprocessedIntegration with a mocked
 * integrationAction and mocked Convex ctx (runQuery/runMutation).
 *
 * runMutation routing is done on argument shape: claim calls carry
 * `candidates`, sync-state upserts carry `strategy` without `candidates`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { ActionCtx } from '../../../../_generated/server';
import { integrationAction } from '../../integration/integration_action';
import { findUnprocessedIntegration } from './find_unprocessed';
import type { IntegrationDataSourceConfig } from './types';

vi.mock('../../integration/integration_action', () => ({
  integrationAction: {
    type: 'integration',
    execute: vi.fn(),
  },
}));

const executeMock = vi.mocked(integrationAction.execute);

interface ClaimCall {
  candidates: { recordId: string; incrementalValue?: string | number }[];
  advanceCursorTo?: string;
  strategy?: string;
  backoffHours: number;
  tableName: string;
}

function createMockCtx(options: {
  syncState?: Record<string, unknown> | null;
  claimResults?: { claimedRecordId: string | null; allProcessed: boolean }[];
}) {
  const claimCalls: ClaimCall[] = [];
  const upsertCalls: Record<string, unknown>[] = [];
  const claimResults = [...(options.claimResults ?? [])];

  const ctx = {
    runQuery: vi.fn(async () => options.syncState ?? null),
    runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ('candidates' in args) {
        claimCalls.push(args as unknown as ClaimCall);
        return (
          claimResults.shift() ?? { claimedRecordId: null, allProcessed: true }
        );
      }
      upsertCalls.push(args);
      return null;
    }),
  };

  return { ctx: ctx as unknown as ActionCtx, claimCalls, upsertCalls };
}

function baseDataSource(
  overrides: Partial<IntegrationDataSourceConfig> = {},
): IntegrationDataSourceConfig {
  return {
    integrationName: 'protel',
    fetchOperation: 'list_guests',
    recordIdField: 'guest_id',
    sourceIdentifier: 'guests',
    ...overrides,
  };
}

const ARGS = {
  organizationId: 'org_1',
  wfDefinitionId: 'wf_1',
  backoffHours: -1,
};

beforeEach(() => {
  executeMock.mockReset();
});

describe('findUnprocessedIntegration', () => {
  it('returns the envelope for the first unprocessed record (SQL shape)', async () => {
    executeMock.mockResolvedValue({
      requiresApproval: false,
      name: 'protel',
      operation: 'list_guests',
      engine: 'mssql',
      data: [{ guest_id: 'g1' }, { guest_id: 'g2' }],
      rowCount: 2,
      duration: 1,
    });
    const { ctx, claimCalls } = createMockCtx({
      claimResults: [{ claimedRecordId: 'g2', allProcessed: false }],
    });

    const result = await findUnprocessedIntegration(ctx, {
      ...ARGS,
      dataSource: baseDataSource(),
    });

    expect(result).toEqual({
      record: { guest_id: 'g2' },
      recordId: 'g2',
      incrementalValue: null,
      tableName: 'integration:protel:guests',
    });
    expect(claimCalls).toHaveLength(1);
    expect(claimCalls[0].candidates.map((c) => c.recordId)).toEqual([
      'g1',
      'g2',
    ]);
  });

  it('returns null when everything is processed', async () => {
    executeMock.mockResolvedValue({ data: [{ guest_id: 'g1' }] });
    const { ctx } = createMockCtx({
      claimResults: [{ claimedRecordId: null, allProcessed: true }],
    });

    const result = await findUnprocessedIntegration(ctx, {
      ...ARGS,
      dataSource: baseDataSource(),
    });
    expect(result).toBeNull();
  });

  it('applies the local JEXL filter before claiming', async () => {
    executeMock.mockResolvedValue({
      data: [
        { guest_id: 'g1', status: 'inactive' },
        { guest_id: 'g2', status: 'active' },
      ],
    });
    const { ctx, claimCalls } = createMockCtx({
      claimResults: [{ claimedRecordId: 'g2', allProcessed: false }],
    });

    const result = await findUnprocessedIntegration(ctx, {
      ...ARGS,
      dataSource: baseDataSource({
        localFilterExpression: 'status == "active"',
      }),
    });

    expect(result?.recordId).toBe('g2');
    expect(claimCalls[0].candidates.map((c) => c.recordId)).toEqual(['g2']);
  });

  it('injects the timestamp watermark into fetch params and extracts incrementalValue', async () => {
    const watermarkMs = Date.parse('2026-06-01T00:00:00.000Z');
    const recordMs = Date.parse('2026-06-02T00:00:00.000Z');
    executeMock.mockResolvedValue({
      data: [{ guest_id: 'g1', modified_date: '2026-06-02T00:00:00.000Z' }],
    });
    const { ctx, claimCalls } = createMockCtx({
      syncState: { strategy: 'timestamp_based', watermark: watermarkMs },
      claimResults: [{ claimedRecordId: 'g1', allProcessed: false }],
    });

    const result = await findUnprocessedIntegration(ctx, {
      ...ARGS,
      dataSource: baseDataSource({
        fetchParams: { status: 'active' },
        incrementalConfig: {
          strategy: 'timestamp_based',
          timestampField: 'modified_date',
          resumeParamKey: 'fromDate',
          timestampFormat: 'iso',
        },
      }),
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'protel',
        operation: 'list_guests',
        params: { status: 'active', fromDate: '2026-06-01T00:00:00.000Z' },
      }),
      { organizationId: 'org_1' },
    );
    expect(result?.incrementalValue).toBe(recordMs);
    expect(claimCalls[0].candidates[0]).toEqual({
      recordId: 'g1',
      recordCreationTime: recordMs,
      incrementalValue: recordMs,
    });
    expect(claimCalls[0].strategy).toBe('timestamp_based');
  });

  it('throws when the fetch operation requires approval', async () => {
    executeMock.mockResolvedValue({
      requiresApproval: true,
      approvalId: 'appr_1',
    });
    const { ctx } = createMockCtx({});

    await expect(
      findUnprocessedIntegration(ctx, {
        ...ARGS,
        dataSource: baseDataSource(),
      }),
    ).rejects.toThrow(/must be read-only/);
  });

  it('throws when cursor_based is configured without cursorPath', async () => {
    const { ctx } = createMockCtx({});
    await expect(
      findUnprocessedIntegration(ctx, {
        ...ARGS,
        dataSource: baseDataSource({
          incrementalConfig: {
            strategy: 'cursor_based',
            resumeParamKey: 'page_info',
          },
        }),
      }),
    ).rejects.toThrow(/cursorPath is required/);
  });

  describe('cursor_based paging', () => {
    const cursorDataSource = baseDataSource({
      recordIdField: 'id',
      sourceIdentifier: 'orders',
      recordsPath: 'result.orders',
      incrementalConfig: {
        strategy: 'cursor_based',
        resumeParamKey: 'page_info',
        cursorPath: 'result.page_info.next',
        maxPages: 3,
      },
    });

    it('advances to the next page when a page is fully processed', async () => {
      executeMock
        .mockResolvedValueOnce({
          result: { orders: [{ id: 1 }], page_info: { next: 'cursor-2' } },
        })
        .mockResolvedValueOnce({
          result: { orders: [{ id: 2 }], page_info: { next: 'cursor-3' } },
        });
      const { ctx, claimCalls } = createMockCtx({
        claimResults: [
          { claimedRecordId: null, allProcessed: true },
          { claimedRecordId: '2', allProcessed: false },
        ],
      });

      const result = await findUnprocessedIntegration(ctx, {
        ...ARGS,
        dataSource: cursorDataSource,
      });

      expect(result?.recordId).toBe('2');
      expect(executeMock).toHaveBeenCalledTimes(2);
      // First fetch has no cursor; second fetch uses the page-1 next cursor.
      expect(executeMock.mock.calls[0][1].params).toEqual({});
      expect(executeMock.mock.calls[1][1].params).toEqual({
        page_info: 'cursor-2',
      });
      // Cursor advancement rides the claim mutation, only on the drained page.
      expect(claimCalls[0].advanceCursorTo).toBe('cursor-2');
      expect(claimCalls[1].advanceCursorTo).toBe('cursor-3');
    });

    it('stops after maxPages fetches', async () => {
      let page = 0;
      executeMock.mockImplementation(async () => {
        page += 1;
        return {
          result: {
            orders: [{ id: page }],
            page_info: { next: `cursor-${page + 1}` },
          },
        };
      });
      const { ctx } = createMockCtx({
        claimResults: [
          { claimedRecordId: null, allProcessed: true },
          { claimedRecordId: null, allProcessed: true },
          { claimedRecordId: null, allProcessed: true },
        ],
      });

      const result = await findUnprocessedIntegration(ctx, {
        ...ARGS,
        dataSource: cursorDataSource,
      });

      expect(result).toBeNull();
      expect(executeMock).toHaveBeenCalledTimes(3);
    });

    it('stops when the source reports no next cursor', async () => {
      executeMock.mockResolvedValue({
        result: { orders: [{ id: 1 }], page_info: {} },
      });
      const { ctx, claimCalls } = createMockCtx({
        claimResults: [{ claimedRecordId: null, allProcessed: true }],
      });

      const result = await findUnprocessedIntegration(ctx, {
        ...ARGS,
        dataSource: cursorDataSource,
      });

      expect(result).toBeNull();
      expect(executeMock).toHaveBeenCalledTimes(1);
      expect(claimCalls[0].advanceCursorTo).toBeUndefined();
    });

    it('clears a stale stored cursor and retries once from scratch', async () => {
      executeMock
        .mockRejectedValueOnce(new Error('page_info expired'))
        .mockResolvedValueOnce({
          result: { orders: [{ id: 7 }], page_info: {} },
        });
      const { ctx, upsertCalls } = createMockCtx({
        syncState: { strategy: 'cursor_based', cursor: 'stale-cursor' },
        claimResults: [{ claimedRecordId: '7', allProcessed: false }],
      });

      const result = await findUnprocessedIntegration(ctx, {
        ...ARGS,
        dataSource: cursorDataSource,
      });

      expect(result?.recordId).toBe('7');
      expect(executeMock).toHaveBeenCalledTimes(2);
      expect(executeMock.mock.calls[0][1].params).toEqual({
        page_info: 'stale-cursor',
      });
      expect(executeMock.mock.calls[1][1].params).toEqual({});
      // The stale cursor was cleared persistently.
      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0]).toMatchObject({ strategy: 'cursor_based' });
      expect(upsertCalls[0].cursor).toBeUndefined();
    });

    it('propagates fetch errors when no stored cursor was used', async () => {
      executeMock.mockRejectedValue(new Error('connection refused'));
      const { ctx } = createMockCtx({});

      await expect(
        findUnprocessedIntegration(ctx, {
          ...ARGS,
          dataSource: cursorDataSource,
        }),
      ).rejects.toThrow(/connection refused/);
      expect(executeMock).toHaveBeenCalledTimes(1);
    });
  });
});
