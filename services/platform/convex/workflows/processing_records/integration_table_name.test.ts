import { describe, expect, it } from 'vitest';

import {
  createIntegrationTableName,
  isIntegrationTableName,
  parseIntegrationTableName,
  SYNC_STATE_RECORD_ID,
} from './integration_table_name';

describe('createIntegrationTableName', () => {
  it('builds the integration:<name>:<source> form', () => {
    expect(createIntegrationTableName('stripe', 'invoices')).toBe(
      'integration:stripe:invoices',
    );
    expect(createIntegrationTableName('shopify', 'orders')).toBe(
      'integration:shopify:orders',
    );
  });

  it('rejects empty parts', () => {
    expect(() => createIntegrationTableName('', 'orders')).toThrow(
      /non-empty integrationName/,
    );
    expect(() => createIntegrationTableName('shopify', '')).toThrow(
      /non-empty sourceIdentifier/,
    );
    expect(() => createIntegrationTableName('   ', 'orders')).toThrow(
      /non-empty integrationName/,
    );
  });

  it('rejects parts containing the separator', () => {
    expect(() => createIntegrationTableName('a:b', 'orders')).toThrow(
      /must not contain ":"/,
    );
    expect(() => createIntegrationTableName('shopify', 'a:b')).toThrow(
      /must not contain ":"/,
    );
  });
});

describe('parseIntegrationTableName', () => {
  it('round-trips a created table name', () => {
    const tableName = createIntegrationTableName('shopify', 'orders');
    expect(parseIntegrationTableName(tableName)).toEqual({
      integrationName: 'shopify',
      sourceIdentifier: 'orders',
    });
  });

  it('returns null for non-integration table names', () => {
    expect(parseIntegrationTableName('customers')).toBeNull();
    expect(parseIntegrationTableName('integration:shopify')).toBeNull();
    expect(parseIntegrationTableName('integration:a:b:c')).toBeNull();
    expect(parseIntegrationTableName('integration::orders')).toBeNull();
    expect(parseIntegrationTableName('integration:shopify:')).toBeNull();
    expect(parseIntegrationTableName('other:shopify:orders')).toBeNull();
    expect(parseIntegrationTableName('')).toBeNull();
  });
});

describe('isIntegrationTableName', () => {
  it('accepts valid integration table names', () => {
    expect(isIntegrationTableName('integration:shopify:orders')).toBe(true);
  });

  it('rejects Convex table names and malformed strings', () => {
    expect(isIntegrationTableName('customers')).toBe(false);
    expect(isIntegrationTableName('integration:shopify')).toBe(false);
  });
});

describe('SYNC_STATE_RECORD_ID', () => {
  it('is the reserved sentinel id', () => {
    expect(SYNC_STATE_RECORD_ID).toBe('__sync_state__');
  });
});
