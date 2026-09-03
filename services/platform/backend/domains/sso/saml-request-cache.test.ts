// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createSamlRequestCache } from './saml-request-cache.ts';

/**
 * The PG-backed node-saml CacheProvider must keep the InMemoryCacheProvider
 * contract — insert-if-absent save, null for unknown/expired gets, atomic
 * consume on remove — because node-saml's replay protection is built on
 * exactly those return values. The SQL itself is proven against real
 * Postgres in integration-check; these tests pin the contract mapping.
 */

interface Captured {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (text: string, values: unknown[]) => object[]): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    sql: tag as unknown as Sql,
    queries,
  };
}

describe('createSamlRequestCache — node-saml CacheProvider contract on PG', () => {
  it('saveAsync inserts a fresh key and reports the stored item', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.startsWith('INSERT INTO app.saml_request_ids')
        ? [{ value: 'instant-1' }]
        : [],
    );
    const cache = createSamlRequestCache(sql);

    const item = await cache.saveAsync('_req1', 'instant-1');

    expect(item).not.toBeNull();
    expect(item?.value).toBe('instant-1');
    // Lazy prune runs before the insert — expired rows never accumulate.
    expect(queries[0]?.text).toContain('DELETE FROM app.saml_request_ids');
    expect(queries[0]?.text).toContain('created_at_ms <');
    expect(queries[1]?.text).toContain('ON CONFLICT (id) DO NOTHING');
    expect(queries[1]?.values[0]).toBe('_req1');
  });

  it('saveAsync answers null for an already-present key (insert-if-absent)', async () => {
    const { sql } = fakeSql(() => []);
    const cache = createSamlRequestCache(sql);

    expect(await cache.saveAsync('_req1', 'instant-2')).toBeNull();
  });

  it('getAsync answers the stored value and filters expired rows in SQL', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.startsWith('SELECT value') ? [{ value: 'instant-1' }] : [],
    );
    const cache = createSamlRequestCache(sql);

    expect(await cache.getAsync('_req1')).toBe('instant-1');
    const select = queries.find((q) => q.text.startsWith('SELECT value'));
    expect(select?.text).toContain('created_at_ms >=');
    expect(select?.values[0]).toBe('_req1');
  });

  it('getAsync answers null for an unknown key', async () => {
    const { sql } = fakeSql(() => []);
    const cache = createSamlRequestCache(sql);

    expect(await cache.getAsync('_missing')).toBeNull();
  });

  it('removeAsync consumes atomically: the key once, then null', async () => {
    let removed = false;
    const { sql } = fakeSql((text) => {
      if (!text.startsWith('DELETE FROM app.saml_request_ids WHERE id')) {
        return [];
      }
      if (removed) return [];
      removed = true;
      return [{ id: '_req1' }];
    });
    const cache = createSamlRequestCache(sql);

    // DELETE .. RETURNING — the second caller finds nothing, which is what
    // stops two concurrent replays both passing the one-time-use gate.
    expect(await cache.removeAsync('_req1')).toBe('_req1');
    expect(await cache.removeAsync('_req1')).toBeNull();
  });

  it('removeAsync answers null for a null key without touching the DB', async () => {
    const { sql, queries } = fakeSql(() => []);
    const cache = createSamlRequestCache(sql);

    expect(await cache.removeAsync(null)).toBeNull();
    expect(queries).toHaveLength(0);
  });
});
