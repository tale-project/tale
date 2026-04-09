import { describe, it, expect } from 'vitest';

import { areAllToolsCacheable } from '../tool_cacheability';

describe('areAllToolsCacheable', () => {
  it('returns true when no tools were called', () => {
    expect(areAllToolsCacheable([], ['web_search'])).toBe(true);
  });

  it('returns true when noCacheToolNames is undefined', () => {
    expect(areAllToolsCacheable(['calculator'], undefined)).toBe(true);
  });

  it('returns true when noCacheToolNames is empty', () => {
    expect(areAllToolsCacheable(['calculator'], [])).toBe(true);
  });

  it('returns true when no called tools overlap with noCacheToolNames', () => {
    expect(areAllToolsCacheable(['calculator', 'rag'], ['web_search'])).toBe(
      true,
    );
  });

  it('returns false when a called tool is in noCacheToolNames', () => {
    expect(
      areAllToolsCacheable(['calculator', 'web_search'], ['web_search']),
    ).toBe(false);
  });

  it('returns false when all called tools are in noCacheToolNames', () => {
    expect(
      areAllToolsCacheable(
        ['web_search', 'db_write'],
        ['web_search', 'db_write'],
      ),
    ).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(areAllToolsCacheable(['Web_Search'], ['web_search'])).toBe(true);
  });
});
