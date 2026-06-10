import type { IntegrationSyncStrategy } from '../../../../workflows/processing_records/integration_sync_state';

export type TimestampFormat = 'iso' | 'epoch_ms' | 'epoch_s' | 'date';

export interface IncrementalConfig {
  strategy: IntegrationSyncStrategy;
  /** timestamp_based: record field carrying the modification timestamp. */
  timestampField?: string;
  /**
   * Fetch parameter that receives the resume value (e.g. `fromDate`,
   * `since_id`, `page_info`). Required for every strategy except full_scan.
   */
  resumeParamKey?: string;
  /** Format the watermark is injected in (timestamp_based, default 'iso'). */
  timestampFormat?: TimestampFormat;
  /**
   * cursor_based: path on the fetch result where the next-page cursor lives
   * (e.g. `result.page_info.next`). Resolved with lodash get.
   */
  cursorPath?: string;
  /** cursor_based: max pages fetched per invocation (default 5, max 20). */
  maxPages?: number;
}

export interface IntegrationDataSourceConfig {
  /** Integration slug, e.g. 'protel', 'shopify'. */
  integrationName: string;
  /** Read-only integration operation, e.g. 'list_guests', 'list_orders'. */
  fetchOperation: string;
  /** Static parameters passed to the operation (remote filtering). */
  fetchParams?: Record<string, unknown>;
  /** Record field holding the stable external id, e.g. 'guest_id', 'id'. */
  recordIdField: string;
  /** Logical source name within the integration, e.g. 'guests', 'orders'. */
  sourceIdentifier: string;
  /**
   * Path on the integration result where the record array lives (lodash get,
   * e.g. 'result.orders'). Defaults: `data` (SQL) then `result` (REST).
   */
  recordsPath?: string;
  /** JEXL expression applied locally to each fetched record. */
  localFilterExpression?: string;
  incrementalConfig?: IncrementalConfig;
}

/**
 * Envelope returned by find_unprocessed. Carrying `recordId` and
 * `incrementalValue` alongside the raw record makes wiring the follow-up
 * record_processed step trivial.
 */
export interface FindUnprocessedIntegrationResult {
  /** The full external record as fetched from the integration. */
  record: Record<string, unknown>;
  /** Stable external record id (from recordIdField). */
  recordId: string;
  /**
   * Watermark value to pass to record_processed: normalized epoch ms for
   * timestamp_based, the id for id_based, null otherwise.
   */
  incrementalValue: string | number | null;
  /** Dedupe key `integration:<name>:<source>`. */
  tableName: string;
}
