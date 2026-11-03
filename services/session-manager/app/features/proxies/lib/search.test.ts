import { describe, expect, it } from 'vitest';

import { validateProxiesSearch } from './search';

describe('validateProxiesSearch', () => {
  it('has no search for an address that names none', () => {
    expect(validateProxiesSearch({})).toEqual({});
  });

  it('keeps what is searched for', () => {
    expect(validateProxiesSearch({ q: '198.51.100' })).toEqual({
      q: '198.51.100',
    });
  });

  it('reads a search the router took for a number as the text it was', () => {
    expect(validateProxiesSearch({ q: 8080 })).toEqual({ q: '8080' });
  });

  it('drops an empty search and one that is no text, and what it does not know', () => {
    expect(validateProxiesSearch({ q: '' })).toEqual({});
    expect(validateProxiesSearch({ q: { a: 1 }, page: 2 })).toEqual({});
  });

  it('gives back a part it drops as undefined, which the router lays over the address', () => {
    const asked = validateProxiesSearch({ q: ['a'] });
    expect('q' in asked).toBe(true);
    expect(asked.q).toBeUndefined();
  });
});
