import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import type { SessionBundle } from '../../auth/session.ts';

const { completeOauth2, connectorWriteAccess, startOauth2 } = vi.hoisted(
  () => ({
    completeOauth2: vi.fn(),
    connectorWriteAccess: vi.fn(),
    startOauth2: vi.fn(),
  }),
);
vi.mock('./oauth.ts', () => ({
  completeOauth2,
  connectorWriteAccess,
  startOauth2,
}));

import { createConnectorOauthRoutes } from './oauth-routes.ts';

function app(session: SessionBundle | null) {
  return createConnectorOauthRoutes({
    sql: {} as never,
    auth: { api: { getSession: async () => session } } as unknown as Auth,
  });
}

const SIGNED_IN: SessionBundle = {
  user: { id: 'u1', email: 'u@example.test', name: 'User' },
  session: { id: 's1', activeOrganizationId: 'org-1' },
};

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
    const response = await app(SIGNED_IN).request(
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

describe('the consent intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SITE_URL', 'https://tale.example');
    vi.stubEnv('BASE_PATH', '');
    connectorWriteAccess.mockResolvedValue('allowed');
    startOauth2.mockResolvedValue({
      kind: 'redirect',
      url: 'https://vendor.example/authorize?state=s',
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('starts an Add when no credential is named', async () => {
    const response = await app(SIGNED_IN).request(
      '/start?connector=gmail&organizationId=org-1',
    );
    expect(response.status).toBe(302);
    expect(startOauth2).toHaveBeenCalledWith(expect.anything(), {
      connectorSlug: 'gmail',
      organizationId: 'org-1',
      userId: 'u1',
      publicOrigin: expect.anything(),
    });
  });

  it('starts a Reconnect of exactly the credential the link names', async () => {
    await app(SIGNED_IN).request(
      '/start?connector=gmail&organizationId=org-1&credentialId=cred-sales',
    );
    expect(startOauth2).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reconnectCredentialId: 'cred-sales' }),
    );
  });

  it.each([
    ['an empty credential id', ''],
    ['an absurdly long credential id', 'x'.repeat(129)],
  ])(
    'refuses %s instead of reading it as an Add',
    async (_what, credentialId) => {
      const response = await app(SIGNED_IN).request(
        `/start?connector=gmail&organizationId=org-1&credentialId=${credentialId}`,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toContain(
        'This credential cannot be reconnected',
      );
      expect(startOauth2).not.toHaveBeenCalled();
    },
  );

  it('answers a Reconnect the service refused with the fixed page, before the vendor', async () => {
    startOauth2.mockResolvedValue({
      kind: 'error',
      error: 'credential_missing',
    });
    const response = await app(SIGNED_IN).request(
      '/start?connector=gmail&organizationId=org-1&credentialId=cred-foreign',
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain(
      'href="https://tale.example/dashboard/org-1/settings/connectors"',
    );
  });

  it('keeps the membership and role gate in front of the intent', async () => {
    connectorWriteAccess.mockResolvedValue('role_forbidden');
    const denied = await app(SIGNED_IN).request(
      '/start?connector=gmail&organizationId=org-1&credentialId=cred-sales',
    );
    connectorWriteAccess.mockResolvedValue('not_member');
    const foreign = await app(SIGNED_IN).request(
      '/start?connector=gmail&organizationId=org-2&credentialId=cred-sales',
    );
    expect([denied.status, foreign.status]).toEqual([403, 403]);
    expect(await foreign.text()).toBe(
      'You do not have access to this organization.',
    );
    expect(startOauth2).not.toHaveBeenCalled();
  });

  it('never lets the callback request name the credential it writes', async () => {
    completeOauth2.mockResolvedValue({
      kind: 'connected',
      settingsUrl: 'https://tale.example/dashboard/org-1/settings/connectors',
      connectorSlug: 'gmail',
    });
    const response = await app(SIGNED_IN).request(
      '/callback?state=s&code=c&credentialId=cred-other&organizationId=org-2',
    );
    expect(response.status).toBe(302);
    expect(completeOauth2).toHaveBeenCalledWith(expect.anything(), {
      state: 's',
      code: 'c',
      vendorError: null,
      requesterUserId: 'u1',
    });
  });

  it.each([
    ['credential_missing', 404, 'This credential cannot be reconnected'],
    ['account_mismatch', 409, 'That is a different workspace'],
    ['forbidden', 403, 'You can no longer connect connectors here'],
  ] as const)(
    'renders the %s refusal as a fixed page',
    async (error, status, title) => {
      completeOauth2.mockResolvedValue({ kind: 'error', error });
      const response = await app(SIGNED_IN).request('/callback?state=s&code=c');
      expect(response.status).toBe(status);
      const html = await response.text();
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain('nothing was saved');
    },
  );
});
