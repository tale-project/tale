import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { parseListQuery } from './routes.ts';
import { KnowledgeEntryError, listEntriesForAgent } from './service.ts';

/**
 * Malformed paging input is the caller's mistake and answers 400. Regression:
 * `Number('abc')` rode into the SQL as NaN, the `::bigint` cast failed, and
 * the listing answered a generic 500 (with an error report) for a bad
 * cursor or limit.
 */
describe('knowledge entries listing query', () => {
  it('coerces a well-formed cursor, limit, and topic', () => {
    const parsed = parseListQuery({ cursor: '42', limit: '10', topic: 'vat' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ cursor: 42, limit: 10, topic: 'vat' });
    }
  });

  it('accepts an empty query string', () => {
    const parsed = parseListQuery({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({});
  });

  it.each([
    ['a non-numeric cursor', { cursor: 'abc' }],
    ['a negative cursor', { cursor: '-1' }],
    ['a fractional cursor', { cursor: '1.5' }],
    ['a non-numeric limit', { limit: 'lots' }],
    ['a zero limit', { limit: '0' }],
    ['a limit past the page cap', { limit: '101' }],
  ])('refuses %s', (_label, raw) => {
    expect(parseListQuery(raw).success).toBe(false);
  });
});

describe('listEntriesForAgent cursor', () => {
  // The agent leg must refuse a bad cursor BEFORE any query runs.
  const neverSql = (() => {
    throw new Error('the listing must not reach the database');
  }) as unknown as Sql;

  it.each(['abc', '-3', '1.5', 'NaN'])(
    'refuses cursor %j as a coded 400 without touching the database',
    async (cursor) => {
      await expect(
        listEntriesForAgent(neverSql, {
          organizationId: 'org-1',
          numItems: 10,
          cursor,
        }),
      ).rejects.toMatchObject({
        name: 'KnowledgeEntryError',
        code: 'KNOWLEDGE_ENTRY_CURSOR_INVALID',
        status: 400,
      });
    },
  );

  it('the refusal is a KnowledgeEntryError the route maps to its status', async () => {
    await expect(
      listEntriesForAgent(neverSql, {
        organizationId: 'org-1',
        numItems: 10,
        cursor: 'abc',
      }),
    ).rejects.toBeInstanceOf(KnowledgeEntryError);
  });
});
