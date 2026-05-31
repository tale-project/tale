import { describe, expect, it } from 'vitest';

import { buildExternalOwnerId, isExternalOwnerId } from './external_identities';

describe('external owner ids', () => {
  it('builds a namespaced owner id', () => {
    expect(buildExternalOwnerId('slack', 'U07ABC123')).toBe('slack:U07ABC123');
  });

  it('treats the system sentinel and namespaced ids as external', () => {
    expect(isExternalOwnerId('system')).toBe(true);
    expect(isExternalOwnerId('slack:U07ABC123')).toBe(true);
  });

  it('treats plain Better Auth ids as internal', () => {
    // Convex/Better Auth ids never contain a separator.
    expect(isExternalOwnerId('k1739f3c8x2abcd1234567890')).toBe(false);
  });
});
