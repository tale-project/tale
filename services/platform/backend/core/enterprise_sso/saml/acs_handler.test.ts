import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';
import type { FinishLogin } from '../login/finish_login';
import {
  flowCookieName,
  hashFlowNonce,
  newFlowNonce,
  SSO_FLOW_MISMATCH_KEY,
} from '../login/flow_cookie';
import { samlAcsHandler } from './acs_handler';
import { buildRelayState } from './relay_state';

const PUBLIC_ORIGIN = 'https://app.example.com';

function nameOf(ref: unknown): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shim's own name symbol
  return (ref as Record<symbol, string>)[Symbol.for('functionName')] ?? '';
}

/** A ctx whose SAML validation answers `validation`; `runMutation` is the
 * audit sink. `finishLogin` is what a successful ACS reaches. */
function acsCtx(validation: Record<string, unknown>): {
  ctx: ActionCtx;
  runQuery: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
  finished: ReturnType<typeof vi.fn>;
  finishLogin: FinishLogin;
} {
  const runQuery = vi.fn().mockResolvedValue({
    organizationId: 'org-1',
    idpEntityId: 'https://idp.example.com/entity',
    idpSsoUrl: 'https://idp.example.com/sso',
    idpCertificate: 'cert',
    wantAssertionsSigned: true,
  });
  const runMutation = vi.fn().mockResolvedValue(undefined);
  const runAction = vi.fn(async (ref: unknown) => {
    switch (nameOf(ref)) {
      case 'enterprise_sso/config/file_actions:getConnectionSecrets':
        return {};
      case 'enterprise_sso/saml/validate_assertion:validateSamlResponse':
        return validation;
      case 'enterprise_sso/internal_actions:handleSsoLogin':
        return { success: true, sessionToken: 'session-token' };
      default:
        throw new Error(`unexpected action ${nameOf(ref)}`);
    }
  });
  const finished = vi.fn();
  const finishLogin: FinishLogin = async (_ctx, args) => {
    finished(args);
    return new Response(null, { status: 302, headers: { Location: '/dashboard' } });
  };
  const ctx = { runQuery, runAction, runMutation } as unknown as ActionCtx;
  return { ctx, runQuery, runMutation, finished, finishLogin };
}

function acsRequest(relayState: string | undefined, cookie?: string): Request {
  const body = new URLSearchParams({ SAMLResponse: 'base64-response' });
  if (relayState !== undefined) body.set('RelayState', relayState);
  return new Request('http://backend-api:3005/api/sso/saml/acs', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: body.toString(),
  });
}

const okValidation = {
  ok: true,
  nameId: 'saml.user@door.test',
  attributes: { email: 'saml.user@door.test' },
};

/**
 * An SP-initiated SAML response (it answers an AuthnRequest) must land in the
 * browser that issued the request: the RelayState's hash has to be of the
 * nonce in this browser's flow cookie. IdP-initiated responses answer no
 * request and carry no binding (sso-3).
 */
describe('samlAcsHandler — browser binding of SP-initiated responses', () => {
  beforeEach(() => {
    process.env.SITE_URL = PUBLIC_ORIGIN;
    delete process.env.BASE_PATH;
  });

  afterEach(() => {
    delete process.env.SITE_URL;
    vi.clearAllMocks();
  });

  async function startedFlow(): Promise<{ relayState: string; cookie: string }> {
    const nonce = newFlowNonce();
    return {
      relayState: buildRelayState('org-1', await hashFlowNonce(nonce)),
      cookie: `${flowCookieName(PUBLIC_ORIGIN)}=${nonce}`,
    };
  }

  it('resolves the org from the RelayState prefix and signs the bound browser in', async () => {
    const flow = await startedFlow();
    const { ctx, runQuery, finished, finishLogin } = acsCtx({
      ...okValidation,
      inResponseTo: '_req1',
    });

    const res = await samlAcsHandler(ctx, acsRequest(flow.relayState, flow.cookie), {
      finishLogin,
    });

    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
    });
    expect(finished).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: 'session-token' }),
    );
    expect(res.status).toBe(302);
    // The flow cookie is spent on the way out.
    expect(res.headers.get('set-cookie')).toBe(
      '__Host-sso_flow=; Max-Age=0; Path=/; HttpOnly; SameSite=None; Secure',
    );
  });

  it('refuses and audits an SP-initiated response without the flow cookie', async () => {
    const flow = await startedFlow();
    const { ctx, runMutation, finished, finishLogin } = acsCtx({
      ...okValidation,
      inResponseTo: '_req1',
    });

    const res = await samlAcsHandler(ctx, acsRequest(flow.relayState), {
      finishLogin,
    });

    expect(finished).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('Location') as string);
    expect(target.origin).toBe(PUBLIC_ORIGIN);
    expect(target.pathname).toBe('/log-in');
    expect(target.searchParams.get('error')).toBe(SSO_FLOW_MISMATCH_KEY);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        action: 'sso_login_failed',
        metadata: expect.objectContaining({
          errorKey: SSO_FLOW_MISMATCH_KEY,
          providerId: 'saml',
        }),
      }),
    );
  });

  it("refuses an SP-initiated response whose RelayState was stripped to the org id", async () => {
    // The attacker rewrites RelayState to look IdP-initiated; the signed
    // Subject still says the response answers a request.
    const flow = await startedFlow();
    const { ctx, finished, finishLogin } = acsCtx({
      ...okValidation,
      inResponseTo: '_req1',
    });

    const res = await samlAcsHandler(ctx, acsRequest('org-1', flow.cookie), {
      finishLogin,
    });

    expect(finished).not.toHaveBeenCalled();
    const target = new URL(res.headers.get('Location') as string);
    expect(target.searchParams.get('error')).toBe(SSO_FLOW_MISMATCH_KEY);
  });

  it("refuses a response bound to another browser's flow", async () => {
    const attacker = await startedFlow();
    const victim = await startedFlow();
    const { ctx, finished, finishLogin } = acsCtx({
      ...okValidation,
      inResponseTo: '_req1',
    });

    const res = await samlAcsHandler(
      ctx,
      acsRequest(attacker.relayState, victim.cookie),
      { finishLogin },
    );

    expect(finished).not.toHaveBeenCalled();
    const target = new URL(res.headers.get('Location') as string);
    expect(target.searchParams.get('error')).toBe(SSO_FLOW_MISMATCH_KEY);
  });

  it('keeps accepting an IdP-initiated response with a bare org RelayState', async () => {
    const { ctx, runQuery, finished, finishLogin } = acsCtx(okValidation);

    const res = await samlAcsHandler(ctx, acsRequest('org-1'), { finishLogin });

    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
    });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('keeps accepting an IdP-initiated response without any RelayState', async () => {
    const { ctx, runQuery, finished, finishLogin } = acsCtx(okValidation);

    await samlAcsHandler(ctx, acsRequest(undefined), { finishLogin });

    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: undefined,
    });
    expect(finished).toHaveBeenCalledTimes(1);
  });
});
