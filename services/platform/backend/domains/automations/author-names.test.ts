// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { memberNamesOf } from './author-names.ts';

/**
 * The names a history answers beside its actors: a member's display name
 * for the person an actor names, `null` for everyone else.
 */

function sqlAnswering(rows: Array<{ id: string; name: string | null }>) {
  const query = vi.fn(
    async (_strings: TemplateStringsArray, ..._v: unknown[]) => rows,
  );
  return { sql: query as unknown as Sql, query };
}

describe('memberNamesOf', () => {
  it('names the person behind a bare id and behind an API key, once each', async () => {
    const { sql, query } = sqlAnswering([
      { id: 'u-ada', name: ' Ada Lovelace ' },
    ]);
    const names = await memberNamesOf(sql, 'org-1', [
      'u-ada',
      'api-key:u-ada',
      'u-ada',
    ]);
    expect(names.get('u-ada')).toBe('Ada Lovelace');
    expect(names.get('api-key:u-ada')).toBe('Ada Lovelace');
    // One lookup, for the one person, in the one organization.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.slice(1)).toEqual(['org-1', ['u-ada']]);
  });

  it('reads a former member, a nameless person and a system actor as null', async () => {
    const { sql } = sqlAnswering([{ id: 'u-ben', name: null }]);
    const names = await memberNamesOf(sql, 'org-1', [
      'u-gone',
      'u-ben',
      'system:pack',
      'trigger:t-1',
      '',
    ]);
    expect(Object.fromEntries(names)).toEqual({
      'u-gone': null,
      'u-ben': null,
      'system:pack': null,
      'trigger:t-1': null,
      '': null,
    });
  });

  it('asks nothing when no actor names a person', async () => {
    const { sql, query } = sqlAnswering([]);
    const names = await memberNamesOf(sql, 'org-1', ['system:pack']);
    expect(names.get('system:pack')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
