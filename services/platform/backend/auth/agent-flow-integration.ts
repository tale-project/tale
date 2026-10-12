import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { AGENT_REDIRECT, DOCUMENT_URL } from './agent-oauth-integration.ts';

/**
 * A coding agent's sign-in as the real-Postgres lanes drive it over HTTP: the
 * authorization request a person is sent from, what the consent page does
 * when they allow, and the token endpoint the agent then calls. The app under
 * test is the real one; the agent's identity is the lane's metadata document
 * (`DOCUMENT_URL`).
 */

export interface AgentFlow {
  /** The agent's authorization request, signed in as `cookie`. */
  begin: (
    cookie: string,
    scope: string,
  ) => Promise<{ verifier: string; oauthQuery: string; page: URL }>;
  /** What the consent page does when the person allows `asked` (the flow's
   * default access when not said) for `body.organizationId` (the flow's
   * organization when not said, none when `null`). */
  allow: (
    cookie: string,
    body?: { scope?: string; organizationId?: string | null },
    asked?: string,
  ) => Promise<AllowedConsent>;
  /** A call of the token endpoint as the agent makes it. */
  token: (
    fields: Record<string, string>,
  ) => Promise<{ status: number; body: unknown }>;
  /** The tokens a successful token answer carries. */
  tokensOf: (body: unknown) => { access_token: string; refresh_token: string };
  /** The agent exchanging the code of an allowed consent for its tokens. */
  exchange: (
    allowed: Pick<AllowedConsent, 'code' | 'verifier'>,
  ) => Promise<{ status: number; body: unknown }>;
}

export interface AllowedConsent {
  status: number;
  answer: {
    url?: string | undefined;
    code?: string | undefined;
    data?: { scopes?: string[] | undefined } | undefined;
  };
  code: string | undefined;
  verifier: string;
  page: URL;
}

export function agentFlow(options: {
  base: string;
  /** The organization the person chooses on the consent page. */
  organizationId: string;
  /** The access the agent asks for when a call does not say. */
  defaultScope: string;
}): AgentFlow {
  const { base, organizationId, defaultScope } = options;
  const issuer = `${base}/api/auth`;
  const headers = { 'content-type': 'application/json', origin: base };

  const locationOf = async (response: Response) => {
    const returned = z.object({ url: z.string() }).safeParse(
      await response
        .clone()
        .json()
        .catch(() => null),
    );
    return new URL(
      response.headers.get('location') ??
        (returned.success ? returned.data.url : '/'),
      base,
    );
  };

  const begin: AgentFlow['begin'] = async (cookie, scope) => {
    const verifier = randomBytes(32).toString('base64url');
    const response = await fetch(
      `${issuer}/oauth2/authorize?${new URLSearchParams({
        client_id: DOCUMENT_URL,
        redirect_uri: AGENT_REDIRECT,
        response_type: 'code',
        scope,
        state: 'lane',
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
      }).toString()}`,
      {
        headers: {
          cookie,
          Accept: 'text/html',
          'Sec-Fetch-Mode': 'navigate',
        },
        redirect: 'manual',
      },
    );
    const next = await locationOf(response);
    return { verifier, oauthQuery: next.search.slice(1), page: next };
  };

  const allow: AgentFlow['allow'] = async (
    cookie,
    body = {},
    asked = defaultScope,
  ) => {
    const { verifier, oauthQuery, page } = await begin(cookie, asked);
    const response = await fetch(`${issuer}/oauth2/consent`, {
      method: 'POST',
      headers: { ...headers, cookie },
      body: JSON.stringify({
        accept: true,
        ...(body.scope === undefined
          ? { scope: asked }
          : { scope: body.scope }),
        oauth_query: oauthQuery,
        ...(body.organizationId === null
          ? {}
          : {
              tale: { organizationId: body.organizationId ?? organizationId },
            }),
      }),
    });
    const answer = z
      .looseObject({
        url: z.string().optional(),
        code: z.string().optional(),
        data: z
          .looseObject({ scopes: z.array(z.string()).optional() })
          .optional(),
      })
      .parse(await response.json());
    const code =
      answer.url === undefined
        ? undefined
        : (new URL(answer.url, base).searchParams.get('code') ?? undefined);
    return { status: response.status, answer, code, verifier, page };
  };

  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const token: AgentFlow['token'] = async (fields) => {
    const response = await fetch(`${issuer}/oauth2/token`, {
      method: 'POST',
      headers: form,
      body: new URLSearchParams({ client_id: DOCUMENT_URL, ...fields }),
    });
    return { status: response.status, body: await response.json() };
  };

  const tokensOf: AgentFlow['tokensOf'] = (body) =>
    z
      .object({ access_token: z.string(), refresh_token: z.string() })
      .parse(body);

  const exchange: AgentFlow['exchange'] = (allowed) =>
    token({
      grant_type: 'authorization_code',
      code: allowed.code ?? '',
      redirect_uri: AGENT_REDIRECT,
      code_verifier: allowed.verifier,
    });

  return { begin, allow, token, tokensOf, exchange };
}
