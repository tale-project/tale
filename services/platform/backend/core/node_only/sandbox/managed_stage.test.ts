import { describe, expect, it } from 'vitest';

import { stageBlobCacheKey } from './managed_stage';
describe('managed staging identity', () => {
  it('scopes immutable cache identity to organization and blob version', () => {
    expect(stageBlobCacheKey('a', 's3:blob')).toBe(
      stageBlobCacheKey('a', 's3:blob'),
    );
    expect(stageBlobCacheKey('a', 's3:blob')).not.toBe(
      stageBlobCacheKey('b', 's3:blob'),
    );
    expect(stageBlobCacheKey('a', 's3:blob')).not.toBe(
      stageBlobCacheKey('a', 's3:new'),
    );
    expect(stageBlobCacheKey('a', 's3:blob')).toMatch(/^[a-f0-9]{64}$/);
  });
});
