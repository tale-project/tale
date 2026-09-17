import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import type { SessionBundle } from '../../auth/session.ts';

const { completeOauth2 } = vi.hoisted(() => ({
  completeOauth2: vi.fn(),
}));
vi.mock('./oauth.ts', () => ({ completeOauth2, startOauth2: vi.fn() }));

import { createConnectorOauthRoutes } from './oauth-routes.ts';

function app(session: SessionBundle | null) {
  return createConnectorOauthRoutes({
    sql: {} as never,
    auth: { api: { getSession: async () => session } } as unknown as Auth,
  });
}

describe('OAuth error recovery', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://tale.example');
    vi.stubEnv('ADDITIONAL_SITE_URLS', 'https://other.example');
    vi.stubEnv('BASE_PATH', '/tale');
    completeOauth2.mockResolvedValue({ kind: 'error', error: 'invalid_state' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('offers a fixed dashboard link without reflecting untrusted callback values', async () => {
    const response = await app(null).request(
      '/callback?state=unknown&error=%3Cscript%3E&organizationId=attacker',
    );
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(html).toContain('href="/tale/dashboard"');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('attacker');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
  });

  it('uses the signed-in session organization and a configured origin for expired state', async () => {
    const response = await app({
      user: { id: 'u1', email: 'u@example.test', name: 'User' },
      session: { id: 's1', activeOrganizationId: 'org-1' },
    }).request(
      'https://other.example/callback?state=expired&organizationId=attacker',
      {
        headers: { host: 'other.example', 'x-forwarded-proto': 'https' },
      },
    );
    expect(await response.text()).toContain(
      'href="https://other.example/tale/dashboard/org-1/settings/connectors"',
    );
  });
});
