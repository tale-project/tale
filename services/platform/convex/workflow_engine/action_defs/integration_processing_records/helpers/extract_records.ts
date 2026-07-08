/**
 * Extraction helpers: locate the record array on an integration result and
 * pull the stable id / incremental watermark value out of each record.
 *
 * Result shapes handled by default:
 * - SQL integrations (`executeSqlIntegration`): rows in `data`
 * - REST integrations (sandbox connector): payload in `result`
 * Anything else needs an explicit `recordsPath` (lodash get syntax).
 */

import get from 'lodash/get';

import { isRecord } from '../../../../../lib/utils/type-utils';
import { normalizeTimestampToMs } from './build_fetch_params';
import type { IntegrationDataSourceConfig } from './types';

function ensureRecordArray(
  value: unknown[],
  location: string,
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      throw new Error(
        `Integration result array at "${location}" contains a non-object item at index ${index} (got ${typeof item})`,
      );
    }
    records.push(item);
  }
  return records;
}

export function extractRecords(
  fetchResult: unknown,
  recordsPath?: string,
): Record<string, unknown>[] {
  if (recordsPath) {
    const value: unknown = get(fetchResult, recordsPath);
    if (!Array.isArray(value)) {
      throw new Error(
        `dataSource.recordsPath "${recordsPath}" did not resolve to an array on the integration result (got ${value === null ? 'null' : typeof value})`,
      );
    }
    return ensureRecordArray(value, recordsPath);
  }

  if (isRecord(fetchResult)) {
    if (Array.isArray(fetchResult.data)) {
      return ensureRecordArray(fetchResult.data, 'data');
    }
    if (Array.isArray(fetchResult.result)) {
      return ensureRecordArray(fetchResult.result, 'result');
    }
  }

  throw new Error(
    'Could not locate a record array on the integration result. Checked "data" (SQL) and "result" (REST) — set dataSource.recordsPath to the array location (e.g. "result.orders").',
  );
}

export function extractRecordId(
  record: Record<string, unknown>,
  recordIdField: string,
): string {
  const value: unknown = get(record, recordIdField);
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(
    `dataSource.recordIdField "${recordIdField}" is missing or not a usable id on a fetched record (got ${value === null ? 'null' : typeof value})`,
  );
}

/**
 * Watermark value for a record: normalized epoch ms for timestamp_based, the
 * raw id for id_based, null for cursor_based/full_scan.
 */
export function extractIncrementalValue(
  record: Record<string, unknown>,
  dataSource: IntegrationDataSourceConfig,
): string | number | null {
  const config = dataSource.incrementalConfig;
  if (!config) {
    return null;
  }

  switch (config.strategy) {
    case 'timestamp_based': {
      if (!config.timestampField) {
        throw new Error(
          'incrementalConfig.timestampField is required for the "timestamp_based" strategy',
        );
      }
      const raw: unknown = get(record, config.timestampField);
      if (raw === undefined || raw === null) {
        return null;
      }
      const ms = normalizeTimestampToMs(raw);
      if (ms === null) {
        console.warn(
          `[integration_processing_records] could not parse timestampField "${config.timestampField}" value as a timestamp; watermark will not advance for this record`,
          { value: raw },
        );
        return null;
      }
      return ms;
    }
    case 'id_based': {
      const raw: unknown = get(record, dataSource.recordIdField);
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
      }
      if (typeof raw === 'string' && raw !== '') {
        return raw;
      }
      return null;
    }
    case 'cursor_based':
    case 'full_scan':
      return null;
    default:
      throw new Error(
        `Unsupported incremental strategy "${String(config.strategy)}"`,
      );
  }
}
