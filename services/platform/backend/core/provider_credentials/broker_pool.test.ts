import type { BrokerResponseMapping } from '@tale/shared/schemas/providers';
import { describe, expect, it } from 'vitest';

import {
  BrokerPoolError,
  buildBrokerAuthHeaders,
  describeEmptyPool,
  diagnoseTokenMapping,
  parseExpiryMs,
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

describe('diagnoseTokenMapping', () => {
  it('maps the happy path, de-duplicating and preserving order', () => {
    const json = pool([
      { access_token: 'tok-a', status: 'active' },
      { access_token: 'tok-b', status: 'active' },
      { access_token: 'tok-a', status: 'active' },
    ]);
    expect(diagnoseTokenMapping(json, MAPPING, NOW, SKEW).usableTokens).toEqual(
      ['tok-a', 'tok-b'],
    );
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
    expect(diagnoseTokenMapping(json, bare, NOW, SKEW).usableTokens).toEqual([
      'tok-a',
    ]);
  });

  it('retains stable account identity and vendor account metadata across refresh', () => {
    const diagnostics = diagnoseTokenMapping(
      pool([
        {
          id: 'account-a',
          account_id: 'chatgpt-a',
          access_token: 'new-token',
          status: 'active',
        },
        {
          id: 'account-a',
          account_id: 'chatgpt-a',
          access_token: 'old-token',
          status: 'active',
        },
        { access_token: 'legacy-token', status: 'active' },
      ]),
      MAPPING,
      NOW,
      SKEW,
    );
    expect(diagnostics.usableAccounts).toEqual([
      { id: 'account-a', accountId: 'chatgpt-a', token: 'new-token' },
      { token: 'legacy-token' },
    ]);
    expect(diagnostics.usableTokens).toEqual(['new-token', 'legacy-token']);
  });

  it('honors quota unavailability until reset without disabling unknown usage', () => {
    const diagnostics = diagnoseTokenMapping(
      pool([
        {
          access_token: 'spent',
          status: 'active',
          available: false,
          available_at: NOW + 60_000,
        },
        { access_token: 'unknown-reset', status: 'active', available: false },
        {
          access_token: 'reset',
          status: 'active',
          available: false,
          available_at: NOW,
        },
        { access_token: 'unknown-usage', status: 'active' },
      ]),
      MAPPING,
      NOW,
      SKEW,
    );
    expect(diagnostics.usableTokens).toEqual(['reset', 'unknown-usage']);
    expect(diagnostics.unavailableCount).toBe(2);
  });

  it('keeps legacy SQLite integer account ids compatible and stable', () => {
    const diagnostics = diagnoseTokenMapping(
      pool([
        { id: 42, access_token: 'token-a', status: 'active' },
        { id: 42, access_token: 'older-token-a', status: 'active' },
        { id: 43, access_token: 'token-b', status: 'active' },
      ]),
      MAPPING,
      NOW,
      SKEW,
    );
    expect(diagnostics.usableAccounts).toEqual([
      { id: '42', token: 'token-a' },
      { id: '43', token: 'token-b' },
    ]);
  });

  it('rejects malformed metadata and invalid explicit expiries', () => {
    const diagnostics = diagnoseTokenMapping(
      pool([
        {
          access_token: 'invalid-expiry',
          status: 'active',
          expires_at: 'later',
        },
        {
          access_token: 'invalid-availability',
          status: 'active',
          available: 'false',
        },
        {
          access_token: 'unsafe-header',
          status: 'active',
          account_id: 'a\r\nb',
        },
        { access_token: 'undated', status: 'active', expires_at: null },
      ]),
      MAPPING,
      NOW,
      SKEW,
    );
    expect(diagnostics.usableTokens).toEqual(['undated']);
    expect(diagnostics.invalidMetadataCount).toBe(3);
  });

  it('does not give OpenAI a token explicitly marked for Anthropic', () => {
    const diagnostics = diagnoseTokenMapping(
      pool([
        {
          access_token: 'wrong-provider',
          status: 'active',
          provider: 'anthropic',
        },
        {
          access_token: 'correct-provider',
          status: 'active',
          provider: 'openai',
        },
        { access_token: 'legacy-provider', status: 'active' },
      ]),
      MAPPING,
      NOW,
      SKEW,
      'openai',
    );
    expect(diagnostics.usableTokens).toEqual([
      'correct-provider',
      'legacy-provider',
    ]);
    expect(diagnostics.providerMismatchCount).toBe(1);
  });
});

describe('describeEmptyPool', () => {
  it('explains missing vendor account identity without dropping healthy peers', () => {
    const diagnostics = diagnoseTokenMapping(
      pool([
        { access_token: 'no-account', status: 'active' },
        {
          access_token: 'has-account',
          status: 'active',
          account_id: 'vendor-a',
        },
      ]),
      MAPPING,
      NOW,
      SKEW,
      'openai',
      true,
    );
    expect(diagnostics.usableTokens).toEqual(['has-account']);
    expect(diagnostics.missingAccountIdCount).toBe(1);
    expect(describeEmptyPool(diagnostics, MAPPING)).toContain('account_id');
  });
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
