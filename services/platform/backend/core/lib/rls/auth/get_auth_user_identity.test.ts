import { describe, it, expect, vi } from 'vitest';

import { getAuthUserIdentity } from './get_auth_user_identity';

function createMockCtx(identity: Record<string, unknown> | null) {
  return {
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(identity),
    },
  } as unknown as Parameters<typeof getAuthUserIdentity>[0];
}

describe('getAuthUserIdentity', () => {
  it('returns null when no identity exists', async () => {
    const ctx = createMockCtx(null);
    const result = await getAuthUserIdentity(ctx);
    expect(result).toBeNull();
  });

  it('returns null when identity has no subject', async () => {
    const ctx = createMockCtx({ email: 'test@example.com' });
    const result = await getAuthUserIdentity(ctx);
    expect(result).toBeNull();
  });

  it('returns null when subject is empty string', async () => {
    const ctx = createMockCtx({ subject: '' });
    const result = await getAuthUserIdentity(ctx);
    expect(result).toBeNull();
  });

  it('returns authenticated user with all fields', async () => {
    const ctx = createMockCtx({
      subject: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
    });
    const result = await getAuthUserIdentity(ctx);
    expect(result).toEqual({
      userId: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
    });
  });

  it('returns authenticated user with only subject', async () => {
    const ctx = createMockCtx({
      subject: 'user-456',
    });
    const result = await getAuthUserIdentity(ctx);
    expect(result).toEqual({
      userId: 'user-456',
      email: undefined,
      name: undefined,
    });
  });

  it('converts null email/name to undefined', async () => {
    const ctx = createMockCtx({
      subject: 'user-789',
      email: null,
      name: null,
    });
    const result = await getAuthUserIdentity(ctx);
    expect(result).toEqual({
      userId: 'user-789',
      email: undefined,
      name: undefined,
    });
  });
});
