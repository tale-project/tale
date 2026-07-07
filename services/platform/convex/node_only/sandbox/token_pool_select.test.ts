import { describe, expect, it } from 'vitest';

import type { TokenSourceResponseMapping } from '../../../lib/shared/schemas/token_sources';
import {
  diagnoseTokenMapping,
  mapTokens,
  parseExpiryMs,
  pickToken,
} from './token_pool_select';

const NOW = 1_700_000_000_000; // fixed "now" in ms
const HOUR = 3_600_000;

// The cc.tale.dev broker shape (one valid configuration of the generic mapping).
const COOLAI_MAPPING: TokenSourceResponseMapping = {
  tokensPath: '$.tokens',
  tokenField: 'access_token',
  statusField: 'status',
  statusActiveValue: 'active',
  expiryField: 'expires_at',
};

describe('mapTokens', () => {
  it('extracts active, unexpired tokens for the cc.tale.dev shape', () => {
    const json = {
      tokens: [
        {
          access_token: 'tok-a',
          status: 'active',
          expires_at: new Date(NOW + 2 * HOUR).toISOString(),
        },
        {
          access_token: 'tok-b',
          status: 'active',
          expires_at: new Date(NOW + 3 * HOUR).toISOString(),
        },
      ],
    };
    expect(mapTokens(json, COOLAI_MAPPING, NOW, 0)).toEqual(['tok-a', 'tok-b']);
  });

  it('drops non-active and expired (within skew) tokens', () => {
    const json = {
      tokens: [
        { access_token: 'ok', status: 'active', expires_at: NOW + 2 * HOUR },
        {
          access_token: 'revoked',
          status: 'inactive',
          expires_at: NOW + 2 * HOUR,
        },
        { access_token: 'expired', status: 'active', expires_at: NOW - HOUR },
        // expires in 2 min → inside a 5-min skew → dropped
        { access_token: 'soon', status: 'active', expires_at: NOW + 120_000 },
      ],
    };
    expect(mapTokens(json, COOLAI_MAPPING, NOW, 300_000)).toEqual(['ok']);
  });

  it('works for a DIFFERENT broker shape via config alone (no hardcoding)', () => {
    const mapping: TokenSourceResponseMapping = {
      tokensPath: '$.data.keys',
      tokenField: 'value',
    };
    const json = { data: { keys: [{ value: 'k1' }, { value: 'k2' }] } };
    expect(mapTokens(json, mapping, NOW, 0)).toEqual(['k1', 'k2']);
  });

  it('keeps tokens with no status/expiry fields configured', () => {
    const mapping: TokenSourceResponseMapping = {
      tokensPath: '$.tokens',
      tokenField: 'access_token',
    };
    const json = { tokens: [{ access_token: 'x' }, { access_token: 'y' }] };
    expect(mapTokens(json, mapping, NOW, HOUR)).toEqual(['x', 'y']);
  });

  it('de-duplicates repeated tokens', () => {
    const json = {
      tokens: [
        { access_token: 'dup', status: 'active' },
        { access_token: 'dup', status: 'active' },
      ],
    };
    const mapping: TokenSourceResponseMapping = {
      tokensPath: '$.tokens',
      tokenField: 'access_token',
      statusField: 'status',
      statusActiveValue: 'active',
    };
    expect(mapTokens(json, mapping, NOW, 0)).toEqual(['dup']);
  });

  it('returns [] for a missing path, non-array, or empty pool', () => {
    expect(mapTokens({}, COOLAI_MAPPING, NOW, 0)).toEqual([]);
    expect(mapTokens({ tokens: 'nope' }, COOLAI_MAPPING, NOW, 0)).toEqual([]);
    expect(mapTokens({ tokens: [] }, COOLAI_MAPPING, NOW, 0)).toEqual([]);
  });

  it('skips items missing the token field', () => {
    const json = {
      tokens: [
        { status: 'active' },
        { access_token: 'good', status: 'active' },
      ],
    };
    expect(mapTokens(json, COOLAI_MAPPING, NOW, 0)).toEqual(['good']);
  });
});

describe('diagnoseTokenMapping', () => {
  it('classifies every drop reason and reports the soonest usable expiry', () => {
    const json = {
      tokens: [
        {
          access_token: 'ok-late',
          status: 'active',
          expires_at: NOW + 3 * HOUR,
        },
        {
          access_token: 'ok-soon',
          status: 'active',
          expires_at: NOW + 2 * HOUR,
        },
        { access_token: 'revoked', status: 'inactive', expires_at: NOW + HOUR },
        { access_token: 'expired', status: 'active', expires_at: NOW - HOUR },
        { status: 'active' }, // no token field
        'not-an-object', // not a record → counts as missing token field
      ],
    };
    expect(diagnoseTokenMapping(json, COOLAI_MAPPING, NOW, 0)).toEqual({
      pathFound: true,
      itemCount: 6,
      usableTokens: ['ok-late', 'ok-soon'],
      missingTokenField: 2,
      inactiveCount: 1,
      expiredCount: 1,
      nextExpiryMs: NOW + 2 * HOUR,
    });
  });

  it('reports a path miss when tokensPath resolves to nothing or a non-array', () => {
    const miss = diagnoseTokenMapping({}, COOLAI_MAPPING, NOW, 0);
    expect(miss.pathFound).toBe(false);
    expect(miss.itemCount).toBe(0);
    expect(miss.usableTokens).toEqual([]);
    expect(
      diagnoseTokenMapping({ tokens: 'nope' }, COOLAI_MAPPING, NOW, 0)
        .pathFound,
    ).toBe(false);
  });

  it('omits nextExpiryMs when no expiry field is configured or parseable', () => {
    const mapping: TokenSourceResponseMapping = {
      tokensPath: '$.tokens',
      tokenField: 'access_token',
    };
    const diag = diagnoseTokenMapping(
      { tokens: [{ access_token: 'x' }] },
      mapping,
      NOW,
      0,
    );
    expect(diag.usableTokens).toEqual(['x']);
    expect(diag.nextExpiryMs).toBeUndefined();
  });

  it('counts skew-window drops as expired (mapTokens parity)', () => {
    const json = {
      tokens: [
        { access_token: 'ok', status: 'active', expires_at: NOW + 2 * HOUR },
        { access_token: 'soon', status: 'active', expires_at: NOW + 120_000 },
      ],
    };
    const diag = diagnoseTokenMapping(json, COOLAI_MAPPING, NOW, 300_000);
    expect(diag.usableTokens).toEqual(['ok']);
    expect(diag.expiredCount).toBe(1);
    expect(mapTokens(json, COOLAI_MAPPING, NOW, 300_000)).toEqual(
      diag.usableTokens,
    );
  });
});

describe('parseExpiryMs', () => {
  it('parses ISO strings, epoch seconds, and epoch ms', () => {
    expect(parseExpiryMs('2026-06-22T18:00:00Z')).toBe(
      Date.parse('2026-06-22T18:00:00Z'),
    );
    expect(parseExpiryMs(1_700_000_000)).toBe(1_700_000_000_000); // seconds → ms
    expect(parseExpiryMs(1_700_000_000_000)).toBe(1_700_000_000_000); // ms as-is
    expect(parseExpiryMs('garbage')).toBeUndefined();
    expect(parseExpiryMs(null)).toBeUndefined();
  });

  it('treats a timezone-less ISO timestamp as UTC (Python utcnow().isoformat())', () => {
    // The broker emits "2026-06-22T18:21:33.093441" with no zone — must pin to
    // UTC, not the host's local time (a UTC+8 host would otherwise be 8h off).
    expect(parseExpiryMs('2026-06-22T18:21:33.093441')).toBe(
      Date.parse('2026-06-22T18:21:33.093441Z'),
    );
    // An explicit offset is respected as-is.
    expect(parseExpiryMs('2026-06-22T18:21:33+02:00')).toBe(
      Date.parse('2026-06-22T18:21:33+02:00'),
    );
  });

  it('parses an epoch encoded as a STRING (broker JSON-encodes the number)', () => {
    // A pure-digit string must follow the numeric seconds/ms heuristic, not be
    // misread by dayjs as a year-1700 date (which would drop the token).
    expect(parseExpiryMs('1700000000')).toBe(1_700_000_000_000); // seconds → ms
    expect(parseExpiryMs('1700000000000')).toBe(1_700_000_000_000); // ms as-is
    expect(parseExpiryMs('  1700000000  ')).toBe(1_700_000_000_000); // trimmed
  });
});

describe('pickToken', () => {
  const pool = ['a', 'b', 'c'];

  it('returns a member of the pool', () => {
    expect(pool).toContain(pickToken(pool, new Set(), 'random', () => 0.5));
  });

  it('random uses the injected rng deterministically', () => {
    expect(pickToken(pool, new Set(), 'random', () => 0)).toBe('a');
    expect(pickToken(pool, new Set(), 'random', () => 0.99)).toBe('c');
  });

  it('excludes already-tried tokens (failover advances)', () => {
    expect(pickToken(pool, new Set(['a']), 'random', () => 0)).toBe('b');
    expect(pickToken(pool, new Set(['a', 'b']), 'random', () => 0)).toBe('c');
  });

  it('returns null when every token is excluded', () => {
    expect(pickToken(pool, new Set(['a', 'b', 'c']), 'random')).toBeNull();
    expect(pickToken([], new Set(), 'random')).toBeNull();
  });

  it('first/round-robin are deterministic and advance with the exclude set', () => {
    expect(pickToken(pool, new Set(), 'first')).toBe('a');
    expect(pickToken(pool, new Set(['a']), 'first')).toBe('b');
    expect(pickToken(pool, new Set(), 'round-robin')).toBe('a');
  });
});
