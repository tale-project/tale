/**
 * Integration Processing Records workflow action
 *
 * Incremental, deduplicated processing of EXTERNAL data sources (SQL/REST
 * integrations) — the integration counterpart of workflow_processing_records:
 * - Dedupe rows live in workflowProcessingRecords under the synthetic
 *   tableName `integration:<integrationName>:<sourceIdentifier>`
 * - Per-workflow sync state (watermark/cursor) lives in a sentinel row in the
 *   same table, so claims and cursor advancement are transactional
 * - Strategies: timestamp_based, id_based, cursor_based (bounded page loop),
 *   full_scan (dedupe only)
 * - The watermark advances only on record_processed, never on claim — a
 *   failed run cannot skip records
 */

import { v } from 'convex/values';

import {
  jsonRecordValidator,
  type ConvexJsonRecord,
} from '../../../lib/validators/json';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { findUnprocessedIntegration } from './helpers/find_unprocessed';
import { recordProcessedIntegration } from './helpers/record_processed';
import type { IntegrationDataSourceConfig } from './helpers/types';

const incrementalConfigValidator = v.object({
  strategy: v.union(
    v.literal('timestamp_based'),
    v.literal('cursor_based'),
    v.literal('id_based'),
    v.literal('full_scan'),
  ),
  timestampField: v.optional(v.string()),
  resumeParamKey: v.optional(v.string()),
  timestampFormat: v.optional(
    v.union(
      v.literal('iso'),
      v.literal('epoch_ms'),
      v.literal('epoch_s'),
      v.literal('date'),
    ),
  ),
  cursorPath: v.optional(v.string()),
  maxPages: v.optional(v.number()),
});

const dataSourceValidator = v.object({
  integrationName: v.string(),
  fetchOperation: v.string(),
  fetchParams: v.optional(jsonRecordValidator),
  recordIdField: v.string(),
  sourceIdentifier: v.string(),
  recordsPath: v.optional(v.string()),
  localFilterExpression: v.optional(v.string()),
  incrementalConfig: v.optional(incrementalConfigValidator),
});

// Type for integration processing records operation params (discriminated union)
type IntegrationProcessingRecordsActionParams =
  | {
      operation: 'find_unprocessed';
      dataSource: IntegrationDataSourceConfig;
      backoffHours: number;
    }
  | {
      operation: 'record_processed';
      integrationName: string;
      sourceIdentifier: string;
      recordId: string;
      incrementalValue?: string | number;
      metadata?: ConvexJsonRecord;
    };

export const integrationProcessingRecordsAction: ActionDefinition<IntegrationProcessingRecordsActionParams> =
  {
    type: 'integration_processing_records',
    title: 'Integration Processing Records Operation',
    description: `Incrementally process records from an EXTERNAL data source (SQL or REST integration) with deduplication.

Operations:
- find_unprocessed: Fetch records via an integration operation and atomically claim the first unprocessed one. Returns an envelope { record, recordId, incrementalValue, tableName } or null when everything is processed.
- record_processed: Mark a claimed external record as processed and advance the incremental watermark.

Incremental strategies (dataSource.incrementalConfig.strategy):
- timestamp_based: stores the highest processed modification timestamp; injects it into fetchParams[resumeParamKey] formatted per timestampFormat ('iso' | 'epoch_ms' | 'epoch_s' | 'date')
- id_based: stores the highest processed id; injects it into fetchParams[resumeParamKey] (e.g. since_id)
- cursor_based: stores an opaque pagination cursor (cursorPath on the fetch result); fetches up to maxPages (default 5) per run; the cursor advances only when a page has zero unprocessed records
- full_scan: no resume state, dedupe only — set fetchParams.limit

Filtering: fetchParams does remote filtering; localFilterExpression applies a JEXL post-filter to each fetched record (transforms: daysAgo(), hoursAgo(), parseDate(), ...).

The fetch operation must be read-only (operations that require approval are rejected).
organizationId and rootWfDefinitionId are automatically read from workflow context variables.`,
    parametersValidator: v.union(
      // find_unprocessed: fetch from the integration and claim one record
      v.object({
        operation: v.literal('find_unprocessed'),
        dataSource: dataSourceValidator,
        backoffHours: v.number(),
      }),
      // record_processed: mark an external record as processed
      v.object({
        operation: v.literal('record_processed'),
        integrationName: v.string(),
        sourceIdentifier: v.string(),
        recordId: v.string(),
        incrementalValue: v.optional(v.union(v.string(), v.number())),
        metadata: v.optional(jsonRecordValidator),
      }),
    ),

    async execute(ctx, params, variables) {
      // Read and validate organizationId and wfDefinitionId from workflow context variables
      const organizationId = variables?.organizationId;
      const wfDefinitionId = variables?.rootWfDefinitionId;

      if (typeof organizationId !== 'string' || !organizationId) {
        throw new Error(
          'integration_processing_records requires a non-empty string organizationId in workflow context',
        );
      }
      if (typeof wfDefinitionId !== 'string' || !wfDefinitionId) {
        throw new Error(
          'integration_processing_records requires a non-empty string rootWfDefinitionId in workflow context',
        );
      }

      switch (params.operation) {
        case 'find_unprocessed': {
          return await findUnprocessedIntegration(ctx, {
            organizationId,
            wfDefinitionId,
            dataSource: params.dataSource,
            backoffHours: params.backoffHours,
          });
        }

        case 'record_processed': {
          return await recordProcessedIntegration(ctx, {
            organizationId,
            wfDefinitionId,
            integrationName: params.integrationName,
            sourceIdentifier: params.sourceIdentifier,
            recordId: params.recordId,
            incrementalValue: params.incrementalValue,
            metadata: params.metadata,
          });
        }

        default:
          throw new Error(
            `Unsupported integration_processing_records operation: ${(params as { operation: string }).operation}`,
          );
      }
    },
  };
