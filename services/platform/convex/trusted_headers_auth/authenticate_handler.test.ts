import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../_generated/server';
import { trustedHeadersAuthenticateHandler } from './authenticate_handler';

// The handler signs a cookie and asks Better Auth for a JWT cookie; neither is
// relevant to the redirect-target hardening under test, so stub both.
vi.mock('../enterprise_sso/sign_cookie_value', () => ({
  signCookieValue: vi.fn().mockResolvedValue('signed-token'),
}));

vi.mock('../auth', () => ({
  createAuth: vi.fn(() => ({
    handler: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
  })),
}));

function createCtx(): ActionCtx {
  return {
    runMutation: vi.fn().mockResolvedValue({
      sessionToken: 'session-token',
      userId: 'user_1',
      organizationId: 'org_1',
      shouldClearOldSession: false,
      trustedHeadersChanged: false,
    }),
  } as unknown as ActionCtx;
}

function authRequest(redirect: string | null): Request {
  const url = new URL(
    'https://app.example.com/api/trusted-headers/authenticate',
  );
  if (redirect !== null) {
    url.searchParams.set('redirect', redirect);
  }
  return new Request(url.toString(), {
    headers: { 'Remote-Email': 'user@example.com' },
  });
}

describe('trustedHeadersAuthenticateHandler — open-redirect hardening (#2037)', () => {
  beforeEach(() => {
    process.env.TRUSTED_HEADERS_ENABLED = 'true';
    process.env.BETTER_AUTH_SECRET = 'test-secret';
    delete process.env.BASE_PATH;
  });

  afterEach(() => {
    delete process.env.TRUSTED_HEADERS_ENABLED;
    delete process.env.BETTER_AUTH_SECRET;
    vi.clearAllMocks();
  });

  // Each entry is a user-controlled `redirect` value that must NOT survive into
  // the navigation sinks; the handler must fall back to the dashboard.
  const hostileRedirects = [
    'https://evil.com',
    'http://evil.com/phish',
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    'dashboard',
  ];

  it.each(hostileRedirects)(
    'neutralises hostile redirect %s and falls back to the dashboard',
    async (redirect) => {
      const res = await trustedHeadersAuthenticateHandler(
        createCtx(),
        authRequest(redirect),
      );
      const html = await res.text();

      expect(res.status).toBe(200);
      // The malicious host/scheme must never reach either navigation sink.
      expect(html).not.toContain('evil.com');
      expect(html).not.toContain('javascript:');
      // Both sinks point at the safe default instead.
      expect(html).toContain('0;url=/dashboard');
      expect(html).toContain("window.location.href = '/dashboard'");
    },
  );

  it('preserves a safe same-origin redirect path', async () => {
    const res = await trustedHeadersAuthenticateHandler(
      createCtx(),
      authRequest('/log-in/team-a?tab=members'),
    );
    const html = await res.text();

    expect(html).toContain('0;url=/log-in/team-a?tab=members');
    expect(html).toContain(
      "window.location.href = '/log-in/team-a?tab=members'",
    );
  });

  it('falls back to the dashboard when no redirect is supplied', async () => {
    const res = await trustedHeadersAuthenticateHandler(
      createCtx(),
      authRequest(null),
    );
    const html = await res.text();

    expect(html).toContain('0;url=/dashboard');
  });
});
