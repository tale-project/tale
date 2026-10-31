// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { appPoolMax, authPoolMax, jsonParam, likeContains } from './sql.ts';

/**
 * `jsonParam` binds any JSON value as one parameter, serialized up front: the
 * pool's json serializer passes a string through verbatim (pg-boss binds
 * pre-serialized JSON), so a bare string handed to `sql.json` would be read
 * as JSON text and fail — or, worse, parse as something else.
 */

/** A stand-in that records what `sql.json` was handed. */
const sql = {
  json: (value: unknown) => ({ json: value }),
} as unknown as Sql;

describe('jsonParam', () => {
  it('serializes once, so a bare string stays a JSON string', () => {
    expect(jsonParam(sql, 'sent')).toEqual({ json: '"sent"' });
    expect(jsonParam(sql, '{"looks":"like json"}')).toEqual({
      json: JSON.stringify('{"looks":"like json"}'),
    });
  });

  it('binds objects, arrays, numbers and booleans as their JSON', () => {
    expect(jsonParam(sql, { a: [1, true] })).toEqual({
      json: '{"a":[1,true]}',
    });
    expect(jsonParam(sql, 0)).toEqual({ json: '0' });
    expect(jsonParam(sql, false)).toEqual({ json: 'false' });
  });

  it('binds SQL NULL for an absent value', () => {
    expect(jsonParam(sql, undefined)).toBeNull();
    expect(jsonParam(sql, null)).toBeNull();
  });
});

describe('likeContains', () => {
  it('matches the token anywhere in the value', () => {
    expect(likeContains('Discovery')).toBe('%Discovery%');
  });

  it('escapes the LIKE metacharacters, so they match only themselves', () => {
    expect(likeContains('50%_off')).toBe('%50\\%\\_off%');
    expect(likeContains('a\\b')).toBe('%a\\\\b%');
  });
});

describe('connection pool sizes', () => {
  it('reads DATABASE_POOL_MAX, defaulting to ten', () => {
    expect(appPoolMax({})).toBe(10);
    expect(appPoolMax({ DATABASE_POOL_MAX: '40' })).toBe(40);
  });

  it('reads AUTH_DATABASE_POOL_MAX, defaulting to the five the auth pool always had', () => {
    expect(authPoolMax({})).toBe(5);
    expect(authPoolMax({ AUTH_DATABASE_POOL_MAX: '24' })).toBe(24);
  });

  it.each(['0', '-3', '2.5', 'many', ''])(
    'ignores a size that is not a positive integer (%j)',
    (raw) => {
      expect(appPoolMax({ DATABASE_POOL_MAX: raw })).toBe(10);
      expect(authPoolMax({ AUTH_DATABASE_POOL_MAX: raw })).toBe(5);
    },
  );
});
