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
  // Return the config so tests can reach `organizationHooks` (the real plugin
  // would consume them internally and expose nothing).
  organization: vi.fn((config: unknown) => config),
  twoFactor: vi.fn(() => ({})),
}));

vi.mock('@better-auth/api-key', () => ({
  apiKey: vi.fn(() => ({})),
}));

vi.mock('better-auth/api', () => ({
  APIError: class APIError extends Error {},
  createAuthMiddleware: (fn: unknown) => fn,
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
  ownerAc: { statements: {} },
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

describe('beforeUpdateOrganization name guard', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // Pull the `beforeUpdateOrganization` hook out of the org plugin config the
  // mock above passes through, so we can exercise the server-side gate directly
  // — the acceptance criterion requires an empty name to be blocked on the
  // server too, and neither the client unit tests nor the Playwright E2E reach
  // this branch.
  async function getBeforeUpdateOrganization() {
    vi.stubEnv('SITE_URL', 'https://app.example.com');
    const { getAuthOptions } = await import('./auth');
    const options = getAuthOptions({} as never);
    // oxlint-disable-next-line typescript/no-explicit-any -- test reaches into the loose better-auth plugin config
    const orgPlugin = (options.plugins as any[]).find(
      (plugin) => plugin?.organizationHooks?.beforeUpdateOrganization,
    );
    expect(orgPlugin).toBeDefined();
    return orgPlugin.organizationHooks.beforeUpdateOrganization as (
      data: unknown,
    ) => Promise<void>;
  }

  it('rejects a whitespace-only name', async () => {
    const beforeUpdate = await getBeforeUpdateOrganization();
    await expect(
      beforeUpdate({ organization: { name: '   ' } }),
    ).rejects.toThrow();
    vi.unstubAllEnvs();
  });

  it('rejects a non-string name', async () => {
    const beforeUpdate = await getBeforeUpdateOrganization();
    await expect(
      beforeUpdate({ organization: { name: 123 } }),
    ).rejects.toThrow();
    vi.unstubAllEnvs();
  });

  it('trims and persists a valid name', async () => {
    const beforeUpdate = await getBeforeUpdateOrganization();
    const data = { organization: { name: '  Acme  ' } };
    await beforeUpdate(data);
    expect(data.organization.name).toBe('Acme');
    vi.unstubAllEnvs();
  });

  it('leaves a name-absent (locale-only) update untouched', async () => {
    const beforeUpdate = await getBeforeUpdateOrganization();
    const data = { organization: { metadata: { defaultLocale: 'de' } } };
    await expect(beforeUpdate(data)).resolves.toBeUndefined();
    expect(data.organization).toEqual({ metadata: { defaultLocale: 'de' } });
    vi.unstubAllEnvs();
  });
});
