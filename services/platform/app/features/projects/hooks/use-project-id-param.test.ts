import { describe, expect, it } from 'vitest';

import { asProjectId } from './use-project-id-param';

describe('asProjectId', () => {
  it('returns the input string unchanged at runtime', () => {
    expect(asProjectId('jh72k1234')).toBe('jh72k1234');
    expect(asProjectId('')).toBe('');
  });

  it('passes through arbitrary strings (Convex validates the actual ID server-side)', () => {
    // The helper is a structural-only cast — runtime is identity.
    // Server-side validation in `chatWithAgent` /
    // `assertProjectAccessForChat` is what actually gates access.
    expect(asProjectId('not-a-real-id')).toBe('not-a-real-id');
    expect(asProjectId('proj_abc123')).toBe('proj_abc123');
  });
});
