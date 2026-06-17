/**
 * find_unprocessed orchestration for external integration data sources.
 *
 * Per invocation: read sync state -> inject resume point into fetchParams ->
 * fetch via integrationAction -> extract record array -> apply local JEXL
 * filter -> atomically claim the first unprocessed record (one internal
 * mutation per page, lightweight candidates only) -> return the envelope
 * { record, recordId, incrementalValue, tableName } or null.
 *
 * cursor_based runs a bounded page loop (maxPages, default 5): the stored
 * cursor advances only when a page contains zero unprocessed records, so a
 * failed run can never skip records.
 */

import { get } from 'lodash';

import { isRecord } from '../../../../../lib/utils/type-utils';
import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import type {
  IntegrationSyncState,
  IntegrationSyncStrategy,
} from '../../../../workflows/processing_records/integration_sync_state';
import { createIntegrationTableName } from '../../../../workflows/processing_records/integration_table_name';
import { createExpressionFilter } from '../../../../workflows/processing_records/query_building/create_expression_filter';
import { integrationAction } from '../../integration/integration_action';
import { buildFetchParams } from './build_fetch_params';
import {
  extractIncrementalValue,
  extractRecordId,
  extractRecords,
} from './extract_records';
import type {
  FindUnprocessedIntegrationResult,
  IntegrationDataSourceConfig,
} from './types';

const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_LIMIT = 20;

interface PageCandidate {
  recordId: string;
  recordCreationTime: number;
  incrementalValue?: string | number;
}

async function executeFetch(
  ctx: ActionCtx,
  dataSource: IntegrationDataSourceConfig,
  params: Record<string, unknown>,
  organizationId: string,
): Promise<unknown> {
  const result = await integrationAction.execute(
    ctx,
    {
      name: dataSource.integrationName,
      operation: dataSource.fetchOperation,
      params,
    },
    { organizationId },
  );

  if (isRecord(result) && result.requiresApproval === true) {
    throw new Error(
      `Integration operation "${dataSource.fetchOperation}" on "${dataSource.integrationName}" requires approval — integration_processing_records fetch operations must be read-only`,
    );
  }

  return result;
}

function extractNextCursor(
  fetchResult: unknown,
  cursorPath: string,
): string | null {
  const raw: unknown = get(fetchResult, cursorPath);
  if (typeof raw === 'string' && raw !== '') {
    return raw;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  return null;
}

export interface FindUnprocessedIntegrationArgs {
  organizationId: string;
  wfDefinitionId: string;
  dataSource: IntegrationDataSourceConfig;
  backoffHours: number;
}

export async function findUnprocessedIntegration(
  ctx: ActionCtx,
  args: FindUnprocessedIntegrationArgs,
): Promise<FindUnprocessedIntegrationResult | null> {
  const { organizationId, wfDefinitionId, dataSource, backoffHours } = args;

  const tableName = createIntegrationTableName(
    dataSource.integrationName,
    dataSource.sourceIdentifier,
  );
  if (!dataSource.fetchOperation) {
    throw new Error('dataSource.fetchOperation is required');
  }
  if (!dataSource.recordIdField) {
    throw new Error('dataSource.recordIdField is required');
  }

  const config = dataSource.incrementalConfig;
  const strategy: IntegrationSyncStrategy = config?.strategy ?? 'full_scan';
  const isCursorBased = strategy === 'cursor_based';

  if (isCursorBased && !config?.cursorPath) {
    throw new Error(
      'incrementalConfig.cursorPath is required for the "cursor_based" strategy',
    );
  }
  if (strategy === 'full_scan' && dataSource.fetchParams?.limit === undefined) {
    console.warn(
      `[integration_processing_records] full_scan without fetchParams.limit for "${tableName}" — every run fetches the whole source; set a limit or use an incremental strategy`,
    );
  }

  let syncState: IntegrationSyncState | null = null;
  if (strategy !== 'full_scan') {
    syncState = await ctx.runQuery(
      internal.workflows.processing_records.internal_queries
        .getIntegrationSyncState,
      { organizationId, tableName, wfDefinitionId },
    );
    if (syncState && syncState.strategy !== strategy) {
      console.warn(
        `[integration_processing_records] stored sync-state strategy "${syncState.strategy}" differs from configured "${strategy}" for "${tableName}"; ignoring stored state`,
      );
      syncState = null;
    }
  }

  const localFilter = dataSource.localFilterExpression
    ? createExpressionFilter(dataSource.localFilterExpression)
    : null;

  const maxPages = isCursorBased
    ? Math.min(
        Math.max(Math.trunc(config?.maxPages ?? DEFAULT_MAX_PAGES), 1),
        MAX_PAGES_LIMIT,
      )
    : 1;

  let currentCursor: string | null = isCursorBased
    ? (syncState?.cursor ?? null)
    : null;
  let usingStoredCursor = isCursorBased && currentCursor !== null;

  for (let page = 0; page < maxPages; page++) {
    const fetchParams = buildFetchParams({
      baseParams: dataSource.fetchParams,
      incrementalConfig: config,
      syncState,
      cursorOverride: isCursorBased ? currentCursor : undefined,
    });

    let fetchResult: unknown;
    try {
      fetchResult = await executeFetch(
        ctx,
        dataSource,
        fetchParams,
        organizationId,
      );
    } catch (error) {
      if (!usingStoredCursor) {
        throw error;
      }
      // A stored cursor can expire upstream (e.g. Shopify page_info).
      // Clear it and retry once from scratch.
      console.warn(
        `[integration_processing_records] fetch with stored cursor failed for "${tableName}"; clearing cursor and retrying from scratch`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      await ctx.runMutation(
        internal.workflows.processing_records.internal_mutations
          .upsertIntegrationSyncState,
        {
          organizationId,
          tableName,
          wfDefinitionId,
          strategy: 'cursor_based',
        },
      );
      currentCursor = null;
      usingStoredCursor = false;
      const retryParams = buildFetchParams({
        baseParams: dataSource.fetchParams,
        incrementalConfig: config,
        syncState: null,
        cursorOverride: null,
      });
      fetchResult = await executeFetch(
        ctx,
        dataSource,
        retryParams,
        organizationId,
      );
    }
    usingStoredCursor = false;

    const records = extractRecords(fetchResult, dataSource.recordsPath);

    const recordsById = new Map<string, Record<string, unknown>>();
    const candidates: PageCandidate[] = [];
    for (const record of records) {
      if (localFilter && !(await localFilter(record))) {
        continue;
      }
      const recordId = extractRecordId(record, dataSource.recordIdField);
      if (recordsById.has(recordId)) {
        console.warn(
          `[integration_processing_records] duplicate recordId "${recordId}" in fetched page for "${tableName}"; keeping the first occurrence`,
        );
        continue;
      }
      recordsById.set(recordId, record);
      const incrementalValue = extractIncrementalValue(record, dataSource);
      candidates.push({
        recordId,
        recordCreationTime:
          strategy === 'timestamp_based' && typeof incrementalValue === 'number'
            ? incrementalValue
            : Date.now(),
        ...(incrementalValue !== null ? { incrementalValue } : {}),
      });
    }

    const nextCursor =
      isCursorBased && config?.cursorPath
        ? extractNextCursor(fetchResult, config.cursorPath)
        : null;
    const shouldAdvanceCursor =
      isCursorBased && nextCursor !== null && nextCursor !== currentCursor;

    const claimResult = await ctx.runMutation(
      internal.workflows.processing_records.internal_mutations
        .claimFirstUnprocessedIntegration,
      {
        organizationId,
        tableName,
        wfDefinitionId,
        backoffHours,
        candidates,
        strategy,
        // Persisted transactionally iff nothing on this page is claimable.
        ...(shouldAdvanceCursor ? { advanceCursorTo: nextCursor } : {}),
      },
    );

    if (claimResult.claimedRecordId !== null) {
      const record = recordsById.get(claimResult.claimedRecordId);
      const candidate = candidates.find(
        (c) => c.recordId === claimResult.claimedRecordId,
      );
      if (!record || !candidate) {
        throw new Error(
          `Claimed recordId "${claimResult.claimedRecordId}" is missing from the fetched page — this should never happen`,
        );
      }
      return {
        record,
        recordId: claimResult.claimedRecordId,
        incrementalValue: candidate.incrementalValue ?? null,
        tableName,
      };
    }

    // Page fully processed. Non-cursor strategies do a single fetch per run.
    if (!isCursorBased || !shouldAdvanceCursor) {
      return null;
    }
    currentCursor = nextCursor;
  }

  return null;
}
