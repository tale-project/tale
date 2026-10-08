// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { jsonParam } from './sql.ts';

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
