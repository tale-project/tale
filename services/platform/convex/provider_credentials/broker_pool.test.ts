import { describe, expect, it } from 'vitest';

import type { BrokerResponseMapping } from '../../lib/shared/schemas/providers';
import {
  BrokerPoolError,
  buildBrokerAuthHeaders,
  describeEmptyPool,
  diagnoseTokenMapping,
  mapTokens,
  parseExpiryMs,
  pickToken,
} from './broker_pool';

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);
const SKEW = 300_000;

const MAPPING: BrokerResponseMapping = {
  tokensPath: '$.tokens',
  tokenField: 'access_token',
  statusField: 'status',
  activeValue: 'active',
  expiresField: 'expires_at',
};

function pool(items: Array<Record<string, unknown>>): Record<string, unknown> {
  return { tokens: items };
}

describe('buildBrokerAuthHeaders', () => {
  it('returns no headers for method none, even without a secret', () => {
    expect(buildBrokerAuthHeaders({ method: 'none' }, undefined)).toEqual({});
  });

  it('builds bearer and custom-header auth from the secret', () => {
    expect(buildBrokerAuthHeaders({ method: 'bearer' }, 's3cret')).toEqual({
      authorization: 'Bearer s3cret',
    });
    expect(
      buildBrokerAuthHeaders(
        { method: 'header', headerName: 'X-Broker-Key' },
        's3cret',
      ),
    ).toEqual({ 'X-Broker-Key': 's3cret' });
  });

  it('throws an actionable error when the secret is missing or empty', () => {
    expect(() =>
      buildBrokerAuthHeaders({ method: 'bearer' }, undefined),
    ).toThrow(BrokerPoolError);
    expect(() =>
      buildBrokerAuthHeaders(
        { method: 'header', headerName: 'X-Broker-Key' },
        '',
      ),
    ).toThrow(/not configured/);
  });
});

describe('parseExpiryMs', () => {
  it('treats small numbers as epoch seconds and large as ms', () => {
    expect(parseExpiryMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(parseExpiryMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('routes pure-digit strings through the numeric heuristic', () => {
    expect(parseExpiryMs('1700000000')).toBe(1_700_000_000_000);
    expect(parseExpiryMs('1700000000000')).toBe(1_700_000_000_000);
  });

  it('parses timezone-less ISO timestamps as UTC', () => {
    expect(parseExpiryMs('2026-07-21T12:00:00')).toBe(NOW);
    expect(parseExpiryMs('2026-07-21T12:00:00Z')).toBe(NOW);
    expect(parseExpiryMs('2026-07-21T14:00:00+02:00')).toBe(NOW);
  });

  it('returns undefined for garbage', () => {
    expect(parseExpiryMs('soon')).toBeUndefined();
    expect(parseExpiryMs(null)).toBeUndefined();
    expect(parseExpiryMs({})).toBeUndefined();
    expect(parseExpiryMs(Number.NaN)).toBeUndefined();
  });
});

describe('diagnoseTokenMapping / mapTokens', () => {
  it('maps the happy path, de-duplicating and preserving order', () => {
    const json = pool([
      { access_token: 'tok-a', status: 'active' },
      { access_token: 'tok-b', status: 'active' },
      { access_token: 'tok-a', status: 'active' },
    ]);
    expect(mapTokens(json, MAPPING, NOW, SKEW)).toEqual(['tok-a', 'tok-b']);
  });

  it('reports a missed tokensPath', () => {
    const diagnostics = diagnoseTokenMapping({ data: [] }, MAPPING, NOW, SKEW);
    expect(diagnostics.pathFound).toBe(false);
    expect(diagnostics.usableTokens).toEqual([]);
  });

  it('counts items without a usable token field', () => {
    const json = pool([
      { access_token: 'tok-a', status: 'active' },
      { status: 'active' },
      { access_token: 42, status: 'active' },
      { access_token: '', status: 'active' },
    ]);
    const diagnostics = diagnoseTokenMapping(json, MAPPING, NOW, SKEW);
    expect(diagnostics.usableTokens).toEqual(['tok-a']);
    expect(diagnostics.missingTokenField).toBe(3);
  });

  it('filters by the status field when the mapping declares one', () => {
    const json = pool([
      { access_token: 'tok-a', status: 'active' },
      { access_token: 'tok-b', status: 'revoked' },
    ]);
    const diagnostics = diagnoseTokenMapping(json, MAPPING, NOW, SKEW);
    expect(diagnostics.usableTokens).toEqual(['tok-a']);
    expect(diagnostics.inactiveCount).toBe(1);
  });

  it('drops tokens expiring within the skew and tracks the next expiry', () => {
    const soon = NOW + SKEW - 1_000;
    const later = NOW + 3_600_000;
    const json = pool([
      { access_token: 'tok-soon', status: 'active', expires_at: soon },
      { access_token: 'tok-later', status: 'active', expires_at: later },
      { access_token: 'tok-undated', status: 'active' },
    ]);
    const diagnostics = diagnoseTokenMapping(json, MAPPING, NOW, SKEW);
    expect(diagnostics.usableTokens).toEqual(['tok-later', 'tok-undated']);
    expect(diagnostics.expiredCount).toBe(1);
    expect(diagnostics.nextExpiryMs).toBe(later);
  });

  it('ignores status and expiry when the mapping declares neither', () => {
    const bare: BrokerResponseMapping = {
      tokensPath: '$.tokens',
      tokenField: 'access_token',
    };
    const json = pool([
      { access_token: 'tok-a', status: 'revoked', expires_at: 0 },
    ]);
    expect(mapTokens(json, bare, NOW, SKEW)).toEqual(['tok-a']);
  });
});

describe('describeEmptyPool', () => {
  it('names the missed path', () => {
    const diagnostics = diagnoseTokenMapping({}, MAPPING, NOW, SKEW);
    expect(describeEmptyPool(diagnostics, MAPPING)).toContain('$.tokens');
  });

  it('distinguishes an empty array from filtered-out items', () => {
    expect(
      describeEmptyPool(
        diagnoseTokenMapping(pool([]), MAPPING, NOW, SKEW),
        MAPPING,
      ),
    ).toContain('empty');

    const filtered = diagnoseTokenMapping(
      pool([
        { access_token: 'tok-a', status: 'revoked' },
        { status: 'active' },
        { access_token: 'tok-c', status: 'active', expires_at: NOW },
      ]),
      MAPPING,
      NOW,
      SKEW,
    );
    const message = describeEmptyPool(filtered, MAPPING);
    expect(message).toContain('access_token');
    expect(message).toContain('statusField');
    expect(message).toContain('expiry skew');
  });
});

describe('pickToken', () => {
  const TOKENS = ['tok-a', 'tok-b', 'tok-c'] as const;

  it('first and round-robin pick the first non-excluded token', () => {
    expect(pickToken(TOKENS, new Set(), 'first')).toBe('tok-a');
    expect(pickToken(TOKENS, new Set(['tok-a']), 'round-robin')).toBe('tok-b');
  });

  it('random picks per the injected random source', () => {
    expect(pickToken(TOKENS, new Set(), 'random', () => 0)).toBe('tok-a');
    expect(pickToken(TOKENS, new Set(), 'random', () => 0.99)).toBe('tok-c');
    expect(pickToken(TOKENS, new Set(['tok-c']), 'random', () => 0.99)).toBe(
      'tok-b',
    );
  });

  it('returns null when every token is excluded', () => {
    expect(pickToken(TOKENS, new Set(TOKENS), 'random')).toBeNull();
    expect(pickToken([], new Set(), 'first')).toBeNull();
  });
});
