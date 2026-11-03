import { describe, expect, it } from 'vitest';

import {
  MAX_QUERY_LENGTH,
  queryChange,
  queryOfAddress,
  viewChange,
} from './query-param';

describe('queryOfAddress', () => {
  it('is the text of the search', () => {
    expect(queryOfAddress('shop login')).toBe('shop login');
  });

  it('is no search for an address without one, or with an empty one', () => {
    expect(queryOfAddress(undefined)).toBeUndefined();
    expect(queryOfAddress('')).toBeUndefined();
  });

  it('is the text a number-like search was typed as, which the router took for a number', () => {
    expect(queryOfAddress(8080)).toBe('8080');
  });

  it('is cut short when it is no search but a document', () => {
    expect(queryOfAddress('x'.repeat(10_000))).toHaveLength(MAX_QUERY_LENGTH);
  });

  it.each([
    ['an object', { a: 1 }],
    ['a list', ['a']],
    ['a flag', true],
    ['null', null],
  ])('is no search when the address holds %s', (_what, value) => {
    expect(queryOfAddress(value)).toBeUndefined();
  });
});

describe('viewChange', () => {
  it('lays its part over the address as it is, so nothing else typed or chosen is lost', () => {
    const { search } = viewChange({ type: 'note' });
    expect(search({ q: 'shop', scope: 3 })).toEqual({
      q: 'shop',
      scope: 3,
      type: 'note',
    });
  });

  it('replaces the entry and leaves the scroll where it is', () => {
    // A view is a way of looking at the page: the back button leaves the page,
    // and the rows scroll in the table, not the page.
    expect(viewChange({ type: 'note' })).toMatchObject({
      replace: true,
      resetScroll: false,
    });
  });
});

describe('queryChange', () => {
  it('sets the search in the address', () => {
    expect(queryChange('198.51').search({ scope: 3 })).toEqual({
      scope: 3,
      q: '198.51',
    });
  });

  it('takes an empty search out of the address, so a plain page keeps a plain address', () => {
    expect(queryChange('').search({ q: 'shop' })).toEqual({ q: undefined });
  });
});
