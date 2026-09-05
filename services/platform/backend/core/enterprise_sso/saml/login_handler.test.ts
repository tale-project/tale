import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';
import { hashFlowNonce } from '../login/flow_cookie';
import { samlLoginHandler } from './login_handler';
import { parseRelayState } from './relay_state';

function loginCtx(): { ctx: ActionCtx; runAction: ReturnType<typeof vi.fn> } {
  const runAction = vi
    .fn()
    .mockResolvedValue({ url: 'https://idp.example.com/sso?SAMLRequest=x' });
  const ctx = {
    runQuery: vi.fn().mockResolvedValue({
      organizationId: 'org-1',
      idpEntityId: 'https://idp.example.com/entity',
      idpSsoUrl: 'https://idp.example.com/sso',
      idpCertificate: 'cert',
    }),
    runAction,
  } as unknown as ActionCtx;
  return { ctx, runAction };
}

/**
 * SP-initiated SAML starts the browser binding: a flow cookie the ACS's
 * cross-site POST can carry (`SameSite=None; Secure` over HTTPS) and a
 * RelayState of `<org>.<sha256(nonce)>` (sso-3).
 */
describe('samlLoginHandler — starts a bound flow', () => {
  beforeEach(() => {
    delete process.env.BASE_PATH;
  });

  afterEach(() => {
    delete process.env.SITE_URL;
    vi.clearAllMocks();
  });

  it('sets a cross-site-capable flow cookie and hashes its nonce into the RelayState', async () => {
    process.env.SITE_URL = 'https://app.example.com';
    const { ctx, runAction } = loginCtx();

    const res = await samlLoginHandler(
      ctx,
      new Request('http://backend-api:3005/api/sso/saml/login?org=org-1'),
    );

    expect(res.status).toBe(302);
    const cookie = res.headers.get('set-cookie') ?? '';
    const match =
      /^__Host-sso_flow=([A-Za-z0-9_-]{43}); Max-Age=600; Path=\/; HttpOnly; SameSite=None; Secure$/.exec(
        cookie,
      );
    expect(match, cookie).not.toBeNull();

    const relayState: unknown = runAction.mock.calls[0]?.[1]?.relayState;
    const relay = parseRelayState(String(relayState));
    expect(relay.organizationId).toBe('org-1');
    expect(relay.flowHash).toBe(await hashFlowNonce(match?.[1] ?? ''));
  });

  it('leaves SameSite off over plain HTTP, where None is not accepted', async () => {
    process.env.SITE_URL = 'http://localhost:3005';
    const { ctx } = loginCtx();

    const res = await samlLoginHandler(
      ctx,
      new Request('http://localhost:3005/api/sso/saml/login?org=org-1'),
    );

    expect(res.headers.get('set-cookie')).toMatch(
      /^sso_flow=[A-Za-z0-9_-]{43}; Max-Age=600; Path=\/; HttpOnly$/,
    );
  });
});
