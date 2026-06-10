import { describe, expect, it } from 'vitest';

import {
  createIntegrationTableName,
  isIntegrationTableName,
  parseIntegrationTableName,
  SYNC_STATE_RECORD_ID,
} from './integration_table_name';

describe('createIntegrationTableName', () => {
  it('builds the integration:<name>:<source> form', () => {
    expect(createIntegrationTableName('protel', 'guests')).toBe(
      'integration:protel:guests',
    );
    expect(createIntegrationTableName('shopify', 'orders')).toBe(
      'integration:shopify:orders',
    );
  });

  it('rejects empty parts', () => {
    expect(() => createIntegrationTableName('', 'guests')).toThrow(
      /non-empty integrationName/,
    );
    expect(() => createIntegrationTableName('protel', '')).toThrow(
      /non-empty sourceIdentifier/,
    );
    expect(() => createIntegrationTableName('   ', 'guests')).toThrow(
      /non-empty integrationName/,
    );
  });

  it('rejects parts containing the separator', () => {
    expect(() => createIntegrationTableName('a:b', 'guests')).toThrow(
      /must not contain ":"/,
    );
    expect(() => createIntegrationTableName('protel', 'a:b')).toThrow(
      /must not contain ":"/,
    );
  });
});

describe('parseIntegrationTableName', () => {
  it('round-trips a created table name', () => {
    const tableName = createIntegrationTableName('protel', 'guests');
    expect(parseIntegrationTableName(tableName)).toEqual({
      integrationName: 'protel',
      sourceIdentifier: 'guests',
    });
  });

  it('returns null for non-integration table names', () => {
    expect(parseIntegrationTableName('customers')).toBeNull();
    expect(parseIntegrationTableName('integration:protel')).toBeNull();
    expect(parseIntegrationTableName('integration:a:b:c')).toBeNull();
    expect(parseIntegrationTableName('integration::guests')).toBeNull();
    expect(parseIntegrationTableName('integration:protel:')).toBeNull();
    expect(parseIntegrationTableName('other:protel:guests')).toBeNull();
    expect(parseIntegrationTableName('')).toBeNull();
  });
});

describe('isIntegrationTableName', () => {
  it('accepts valid integration table names', () => {
    expect(isIntegrationTableName('integration:protel:guests')).toBe(true);
  });

  it('rejects Convex table names and malformed strings', () => {
    expect(isIntegrationTableName('customers')).toBe(false);
    expect(isIntegrationTableName('integration:protel')).toBe(false);
  });
});

describe('SYNC_STATE_RECORD_ID', () => {
  it('is the reserved sentinel id', () => {
    expect(SYNC_STATE_RECORD_ID).toBe('__sync_state__');
  });
});
