/**
 * Integration Processing Records Action
 *
 * This action enables incremental processing of external data sources
 * (SQL databases, REST APIs) with deduplication and concurrency control.
 *
 * Key features:
 * - Fetches data via existing integration infrastructure
 * - Reuses workflowProcessingRecords table for deduplication
 * - Supports 4 find strategies: find_by_timestamp, find_by_cursor, find_by_id, find_all
 * - Two-layer filtering: remote params + local JEXL filter
 *
 * @example Protel Reservations (SQL - timestamp based, batch of 10)
 * ```typescript
 * {
 *   type: 'action',
 *   action: 'integration_processing_records',
 *   params: {
 *     strategy: 'find_by_timestamp',
 *     integration: 'protel',
 *     action: 'list_reservations',
 *     params: { buchstatus: 0 },
 *     uniqueKey: 'reservation_id',
 *     tag: 'upcoming_arrivals',
 *     filter: 'daysAgo(check_in_date) >= -14 && daysAgo(check_in_date) <= -7',
 *     cursor: {
 *       field: 'check_in_date',
 *       actionParam: 'fromDate',
 *       format: 'date',
 *     },
 *     backoffHours: 168,
 *     limit: 10, // Return up to 10 records per call (default: 1)
 *   },
 * }
 * // Returns: Record<string, unknown>[] | null
 * // Use with loop node to process each record
 * ```
 *
 * @example Shopify Orders (REST API - cursor based)
 * ```typescript
 * {
 *   type: 'action',
 *   action: 'integration_processing_records',
 *   params: {
 *     strategy: 'find_by_cursor',
 *     integration: 'shopify',
 *     action: 'list_orders',
 *     params: { status: 'any', limit: 50 },
 *     uniqueKey: 'id',
 *     tag: 'orders',
 *     filter: 'financial_status == "paid" && fulfillment_status == null',
 *     cursor: { field: 'page_info' },
 *     backoffHours: 24,
 *     limit: 5, // Process 5 orders per workflow execution
 *   },
 * }
 * ```
 *
 * @example Record Processed
 * ```typescript
 * {
 *   type: 'action',
 *   action: 'integration_processing_records',
 *   params: {
 *     strategy: 'record_processed',
 *     integration: 'protel',
 *     tag: 'upcoming_arrivals',
 *     recordId: '{{reservationId}}',
 *     metadata: { processedAt: '{{now}}' },
 *   },
 * }
 * ```
 */

import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { findUnprocessed } from './helpers/find_unprocessed';
import { recordProcessed } from './helpers/record_processed';
import type { IntegrationProcessingRecordsParams } from './types';
import { integrationProcessingRecordsParamsValidator } from './validators';

export const integrationProcessingRecordsAction: ActionDefinition<IntegrationProcessingRecordsParams> =
  {
    type: 'integration_processing_records',
    title: 'Integration Processing Records Operation',
    description: `Execute integration processing records operations for external data sources.

Strategies:
- find_by_timestamp: Use a timestamp field for incremental sync (e.g., modified_date)
- find_by_cursor: Use cursor/page_info pagination (e.g., Shopify)
- find_by_id: Use monotonically increasing IDs (e.g., since_id)
- find_all: Full scan with local deduplication (no incremental support)
- record_processed: Mark a record as processed

The find strategies:
1. Build fetch params with cursor injection (if resume point exists)
2. Call the integration to fetch external data
3. Apply local JEXL filtering (if configured)
4. Check processing status against workflowProcessingRecords
5. Claim and return unprocessed records (up to the specified limit)

Returns an array of claimed records or null if no unprocessed records found.
Use the 'limit' parameter to control how many records to return per call (default: 1).
Throws an error if claiming fails, which aborts the workflow for retry.

Cursor Configuration:
- field: Field name in response to extract cursor value from
- actionParam: Parameter name to pass cursor value to action (defaults to field)
- format: Timestamp format for parsing/formatting (iso, epoch_ms, epoch_s, date)

Filtering:
- Remote: params - sent to integration as-is
- Local: filter - JEXL expression applied in-memory

Available JEXL transforms: daysAgo(), hoursAgo(), minutesAgo(), parseDate(), isBefore(), isAfter()

organizationId and rootWfDefinitionId are automatically read from workflow context variables.`,

    parametersValidator: integrationProcessingRecordsParamsValidator,

    async execute(ctx, params, variables) {
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

      switch (params.strategy) {
        case 'find_by_timestamp':
        case 'find_by_cursor':
        case 'find_by_id':
        case 'find_all':
          return findUnprocessed(ctx, {
            organizationId,
            wfDefinitionId,
            ...params,
          });

        case 'record_processed':
          return recordProcessed(ctx, {
            organizationId,
            wfDefinitionId,
            integration: params.integration,
            tag: params.tag,
            recordId: params.recordId,
            metadata: params.metadata,
          });

        default:
          throw new Error(
            `Unsupported integration_processing_records strategy: ${(params as { strategy: string }).strategy}`,
          );
      }
    },
  };
