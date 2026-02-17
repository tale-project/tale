import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock all external dependencies to test getAuthOptions in isolation
vi.mock('@convex-dev/better-auth', () => ({
  createClient: vi.fn(() => ({
    adapter: vi.fn(() => ({})),
  })),
}));

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({})),
}));

vi.mock('better-auth/plugins', () => ({
  apiKey: vi.fn(() => ({})),
  organization: vi.fn(() => ({})),
}));

vi.mock('better-auth/plugins/access', () => ({
  createAccessControl: vi.fn(() => ({
    newRole: vi.fn(() => ({
      authorize: vi.fn(() => ({ success: true })),
    })),
  })),
}));

vi.mock('better-auth/plugins/organization/access', () => ({
  defaultStatements: {},
  adminAc: { statements: {} },
}));

vi.mock('@convex-dev/better-auth/plugins', () => ({
  convex: vi.fn(() => ({})),
}));

vi.mock('./_generated/api', () => ({
  components: {
    betterAuth: {},
  },
}));

vi.mock('./auth.config', () => ({
  default: {},
}));

vi.mock('./betterAuth/schema', () => ({
  default: {},
}));

describe('auth trustedOrigins', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('derives trustedOrigins from SITE_URL', async () => {
    vi.stubEnv('SITE_URL', 'https://app.example.com');

    const { getAuthOptions } = await import('./auth');
    const options = getAuthOptions({} as never);

    expect(options.trustedOrigins).toEqual(['https://app.example.com']);

    vi.unstubAllEnvs();
  });

  it('uses localhost origin as default when SITE_URL is not set', async () => {
    vi.stubEnv('SITE_URL', '');

    const { getAuthOptions } = await import('./auth');
    const options = getAuthOptions({} as never);

    expect(options.trustedOrigins).toEqual(['http://127.0.0.1:3000']);

    vi.unstubAllEnvs();
  });

  it('does not use wildcard origins', async () => {
    vi.stubEnv('SITE_URL', 'https://app.example.com');

    const { getAuthOptions } = await import('./auth');
    const options = getAuthOptions({} as never);

    for (const origin of options.trustedOrigins) {
      expect(origin).not.toContain('*');
    }

    vi.unstubAllEnvs();
  });
});
