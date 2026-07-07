import { describe, expect, it } from 'vitest';

import { parseUserResource } from './mappers';

describe('parseUserResource email normalization', () => {
  it('lowercases userName and emails', () => {
    const input = parseUserResource({
      userName: 'User@Example.COM',
      displayName: 'Test User',
    });
    expect(input?.email).toBe('user@example.com');
  });
});
