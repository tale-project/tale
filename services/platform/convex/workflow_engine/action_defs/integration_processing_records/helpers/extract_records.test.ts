import { describe, expect, it } from 'vitest';

import {
  extractIncrementalValue,
  extractRecordId,
  extractRecords,
} from './extract_records';
import type { IntegrationDataSourceConfig } from './types';

const rows = [
  { guest_id: 'g1', modified_date: '2026-06-01T00:00:00.000Z' },
  { guest_id: 'g2', modified_date: '2026-06-02T00:00:00.000Z' },
];

describe('extractRecords', () => {
  it('reads SQL results from "data"', () => {
    const sqlResult = {
      requiresApproval: false,
      name: 'shopify',
      operation: 'list_guests',
      engine: 'mssql',
      data: rows,
      rowCount: 2,
      duration: 5,
    };
    expect(extractRecords(sqlResult)).toEqual(rows);
  });

  it('reads REST results from "result"', () => {
    const restResult = {
      name: 'shopify',
      operation: 'list_orders',
      result: rows,
      duration: 5,
      version: '1.0.0',
    };
    expect(extractRecords(restResult)).toEqual(rows);
  });

  it('resolves an explicit recordsPath', () => {
    const nested = { result: { orders: rows, page_info: { next: 'abc' } } };
    expect(extractRecords(nested, 'result.orders')).toEqual(rows);
  });

  it('throws when recordsPath does not resolve to an array', () => {
    expect(() =>
      extractRecords({ result: { orders: rows } }, 'result.nope'),
    ).toThrow(/did not resolve to an array/);
  });

  it('throws a descriptive error when no array is found', () => {
    expect(() => extractRecords({ result: { orders: rows } })).toThrow(
      /set dataSource.recordsPath/,
    );
  });

  it('throws when the array contains non-object items', () => {
    expect(() => extractRecords({ data: ['nope'] })).toThrow(
      /non-object item at index 0/,
    );
  });
});

describe('extractRecordId', () => {
  it('returns string ids and stringifies numeric ids', () => {
    expect(extractRecordId({ guest_id: 'g1' }, 'guest_id')).toBe('g1');
    expect(extractRecordId({ id: 42 }, 'id')).toBe('42');
  });

  it('resolves nested paths', () => {
    expect(extractRecordId({ guest: { id: 'g1' } }, 'guest.id')).toBe('g1');
  });

  it('throws when the field is missing or unusable', () => {
    expect(() => extractRecordId({ other: 1 }, 'guest_id')).toThrow(
      /missing or not a usable id/,
    );
    expect(() => extractRecordId({ guest_id: '' }, 'guest_id')).toThrow(
      /missing or not a usable id/,
    );
    expect(() => extractRecordId({ guest_id: null }, 'guest_id')).toThrow(
      /missing or not a usable id/,
    );
  });
});

function dataSource(
  overrides: Partial<IntegrationDataSourceConfig>,
): IntegrationDataSourceConfig {
  return {
    integrationName: 'shopify',
    fetchOperation: 'list_guests',
    recordIdField: 'guest_id',
    sourceIdentifier: 'guests',
    ...overrides,
  };
}

describe('extractIncrementalValue', () => {
  it('returns null without incremental config', () => {
    expect(extractIncrementalValue(rows[0], dataSource({}))).toBeNull();
  });

  it('normalizes timestamp_based values to epoch ms', () => {
    const config = dataSource({
      incrementalConfig: {
        strategy: 'timestamp_based',
        timestampField: 'modified_date',
        resumeParamKey: 'fromDate',
      },
    });
    expect(extractIncrementalValue(rows[0], config)).toBe(
      Date.parse('2026-06-01T00:00:00.000Z'),
    );
  });

  it('returns null and warns for an unparseable timestamp', () => {
    const config = dataSource({
      incrementalConfig: {
        strategy: 'timestamp_based',
        timestampField: 'modified_date',
        resumeParamKey: 'fromDate',
      },
    });
    expect(
      extractIncrementalValue({ modified_date: 'garbage' }, config),
    ).toBeNull();
    expect(extractIncrementalValue({}, config)).toBeNull();
  });

  it('throws when timestampField is missing from the config', () => {
    const config = dataSource({
      incrementalConfig: {
        strategy: 'timestamp_based',
        resumeParamKey: 'fromDate',
      },
    });
    expect(() => extractIncrementalValue(rows[0], config)).toThrow(
      /timestampField is required/,
    );
  });

  it('uses the recordIdField for id_based', () => {
    const config = dataSource({
      recordIdField: 'id',
      incrementalConfig: { strategy: 'id_based', resumeParamKey: 'since_id' },
    });
    expect(extractIncrementalValue({ id: 42 }, config)).toBe(42);
    expect(extractIncrementalValue({ id: 'ORD-42' }, config)).toBe('ORD-42');
    expect(extractIncrementalValue({}, config)).toBeNull();
  });

  it('returns null for cursor_based and full_scan', () => {
    expect(
      extractIncrementalValue(
        rows[0],
        dataSource({
          incrementalConfig: {
            strategy: 'cursor_based',
            resumeParamKey: 'page_info',
            cursorPath: 'result.next',
          },
        }),
      ),
    ).toBeNull();
    expect(
      extractIncrementalValue(
        rows[0],
        dataSource({ incrementalConfig: { strategy: 'full_scan' } }),
      ),
    ).toBeNull();
  });
});
