import { describe, expect, it } from 'vitest';

import { MAX_QUERY_LENGTH } from '@/app/lib/query-param';

import {
  filtersFromSearch,
  matchesFilters,
  NO_FILTERS,
  queryFromSearch,
  searchFromFilters,
  validateSecretsSearch,
} from './filters';

const everySession = { kind: 'credentials' as const, session: null };
const ofSession = (
  id: number,
  kind: 'note' | 'credentials' = 'credentials',
) => ({
  kind,
  session: { id, name: String(id), status: 'stopped' as const },
});

describe('validateSecretsSearch', () => {
  it('has no filter for an address that names none', () => {
    expect(validateSecretsSearch({})).toEqual({});
  });

  it.each(['personal', 'credentials', 'card', 'note'])(
    'keeps the type %s',
    (type) => {
      expect(validateSecretsSearch({ type })).toEqual({ type });
    },
  );

  it('keeps the scope of every session, and of a session by its number', () => {
    expect(validateSecretsSearch({ scope: 'global' })).toEqual({
      scope: 'global',
    });
    expect(validateSecretsSearch({ scope: 12 })).toEqual({ scope: 12 });
  });

  it('reads a session number written as text, as a hand-typed address has it', () => {
    expect(validateSecretsSearch({ scope: '12' })).toEqual({ scope: 12 });
    expect(validateSecretsSearch({ scope: '0012' })).toEqual({ scope: 12 });
  });

  it('keeps both', () => {
    expect(validateSecretsSearch({ type: 'note', scope: 3 })).toEqual({
      type: 'note',
      scope: 3,
    });
  });

  it('drops a type that is no kind of secret, and keeps the rest', () => {
    expect(validateSecretsSearch({ type: 'passwords', scope: 3 })).toEqual({
      scope: 3,
    });
    expect(validateSecretsSearch({ type: 4 })).toEqual({});
    expect(validateSecretsSearch({ type: ['note'] })).toEqual({});
  });

  it.each([
    ['text', 'all'],
    ['a name', 'Shop'],
    ['zero', 0],
    ['a negative number', -3],
    ['a fraction', 1.5],
    ['text with digits in it', '3 sessions'],
    ['too large a number', 1e300],
    ['a flag', true],
    ['an empty text', ''],
  ])('drops a scope that is %s', (_what, scope) => {
    expect(validateSecretsSearch({ type: 'card', scope })).toEqual({
      type: 'card',
    });
  });

  it('keeps what is searched for', () => {
    expect(validateSecretsSearch({ q: 'shop login' })).toEqual({
      q: 'shop login',
    });
    expect(validateSecretsSearch({ type: 'note', q: 'wifi' })).toEqual({
      type: 'note',
      q: 'wifi',
    });
  });

  it('reads a search the router took for a number as the text it was', () => {
    expect(validateSecretsSearch({ q: 4242 })).toEqual({ q: '4242' });
  });

  it('has no search for an empty one', () => {
    expect(validateSecretsSearch({ q: '' })).toEqual({});
  });

  it('cuts a search that is no search, not a document, short', () => {
    const asked = validateSecretsSearch({ q: 'x'.repeat(5000) });
    expect(asked.q).toHaveLength(MAX_QUERY_LENGTH);
  });

  it('drops a search that is no text', () => {
    expect(validateSecretsSearch({ q: { a: 1 } })).toEqual({});
    expect(validateSecretsSearch({ q: ['a'] })).toEqual({});
    expect(validateSecretsSearch({ q: true })).toEqual({});
  });

  it('gives back the parts it drops as undefined, which the router lays over the address', () => {
    const asked = validateSecretsSearch({ type: 'passwords' });
    expect('type' in asked).toBe(true);
    expect(asked.type).toBeUndefined();
  });

  it('drops what it does not know, so another parameter never breaks the page', () => {
    expect(validateSecretsSearch({ type: 'note', page: 2, sort: 'a' })).toEqual(
      {
        type: 'note',
      },
    );
  });
});

describe('queryFromSearch', () => {
  it('is what the box holds: the search, or nothing', () => {
    expect(queryFromSearch({ q: 'shop' })).toBe('shop');
    expect(queryFromSearch({})).toBe('');
  });
});

describe('filtersFromSearch', () => {
  it('shows everything for an address without filters', () => {
    expect(filtersFromSearch({})).toEqual(NO_FILTERS);
    expect(NO_FILTERS).toEqual({ kind: 'all', scope: 'all' });
  });

  it('names the kind, and the scope as the values of the scope filter', () => {
    expect(filtersFromSearch({ type: 'card' })).toEqual({
      kind: 'card',
      scope: 'all',
    });
    expect(filtersFromSearch({ scope: 'global' })).toEqual({
      kind: 'all',
      scope: 'global',
    });
    expect(filtersFromSearch({ scope: 12 })).toEqual({
      kind: 'all',
      scope: '12',
    });
  });
});

describe('searchFromFilters', () => {
  it('leaves out what shows everything, so an unfiltered list has a plain address', () => {
    expect(searchFromFilters(NO_FILTERS)).toEqual({});
    expect(searchFromFilters({ kind: 'note', scope: 'all' })).toEqual({
      type: 'note',
    });
  });

  it('writes a session by its number, as a number: an address reads /secrets?scope=12', () => {
    expect(searchFromFilters({ kind: 'all', scope: '12' })).toEqual({
      scope: 12,
    });
    expect(searchFromFilters({ kind: 'all', scope: 'global' })).toEqual({
      scope: 'global',
    });
  });

  it('says "none" for the filter that shows everything, so laid over an address it takes the filter away', () => {
    const lifted = searchFromFilters(NO_FILTERS);
    expect('type' in lifted && 'scope' in lifted).toBe(true);
    expect({ type: 'note', scope: 3, q: 'x', ...lifted }).toEqual({ q: 'x' });
  });

  it('is what filtersFromSearch reads back', () => {
    for (const filters of [
      NO_FILTERS,
      { kind: 'note' as const, scope: 'all' },
      { kind: 'all' as const, scope: 'global' },
      { kind: 'card' as const, scope: '7' },
    ]) {
      expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters);
    }
  });
});

describe('matchesFilters', () => {
  it('shows every secret when nothing narrows the list', () => {
    expect(matchesFilters(everySession, NO_FILTERS)).toBe(true);
    expect(matchesFilters(ofSession(3, 'note'), NO_FILTERS)).toBe(true);
  });

  it('narrows by kind', () => {
    expect(
      matchesFilters(ofSession(3, 'note'), { kind: 'note', scope: 'all' }),
    ).toBe(true);
    expect(matchesFilters(ofSession(3), { kind: 'note', scope: 'all' })).toBe(
      false,
    );
  });

  it("narrows by who a secret is for: every session, or one session's own", () => {
    expect(matchesFilters(everySession, { kind: 'all', scope: 'global' })).toBe(
      true,
    );
    expect(matchesFilters(ofSession(3), { kind: 'all', scope: 'global' })).toBe(
      false,
    );
    expect(matchesFilters(ofSession(3), { kind: 'all', scope: '3' })).toBe(
      true,
    );
    expect(matchesFilters(everySession, { kind: 'all', scope: '3' })).toBe(
      false,
    );
  });

  it('needs both when both narrow it', () => {
    const both = { kind: 'note' as const, scope: '3' };
    expect(matchesFilters(ofSession(3, 'note'), both)).toBe(true);
    expect(matchesFilters(ofSession(3, 'credentials'), both)).toBe(false);
    expect(matchesFilters(ofSession(4, 'note'), both)).toBe(false);
  });
});
