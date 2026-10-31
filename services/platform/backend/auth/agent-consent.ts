import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  isAgentScope,
  needsFreshSession,
  OFFLINE_ACCESS,
  requestsAgentAccess,
  scopeCeilingForRole,
  scopesOf,
} from '../../lib/shared/agent-access.ts';
import {
  SESSION_FRESH_AGE_SECONDS,
  SESSION_NOT_FRESH_CODE,
} from '../../lib/shared/constants/session-freshness.ts';
import { isRecord } from '../../lib/utils/type-utils.ts';
import {
  agentClientIdentity,
  readAgentClientRow,
} from '../domains/agent_connections/client-identity.ts';
import {
  agentConnectionActor,
  connectAgent,
} from '../domains/agent_connections/service.ts';
import { evaluateTwoFactorEnforcement } from '../domains/two_factor/service.ts';
import { mayConnectAgentIn } from './api-key-create-gate.ts';
import { findOrganizationMember } from './membership.ts';

/**
 * A person connecting a coding agent to one organization, at the consent step
 * of the sign-in server.
 *
 * Better Auth's consent endpoint knows an app, a person and the scopes
 * asked for; it knows nothing of organizations. A coding agent works in one
 * organization, chosen by the person on the consent page, so the grant is
 * tied to it: the organization rides the consent as its `referenceId`, and
 * from there the code, the refresh token and every access token — whose
 * claims name it (`oidc.ts`).
 *
 * The consent endpoint is reached through the gate below, which runs first:
 * it checks that the person may connect an agent to that organization, with
 * that access, and only then lets the provider make the consent. An agent
 * grant is never made without the gate: a consent for agent access that
 * names no organization is tied to a reference no consent ever has, so the
 * provider shows the consent page again, and a code made without it earns no
 * token (`oidc.ts` asks the organization of the reference, and there is
 * none).
 */

/** What the reference of an agent request starts with until the person has
 * chosen an organization. Each one is made new, so no consent stored under
 * one — which only a consent made around the gate could be — is found again
 * by the next request, and the person is always shown the consent page. */
export const AGENT_UNBOUND_REFERENCE_PREFIX = 'agent:unbound:';

/** The organization the person chose, for the provider's consent call. */
const chosen = new AsyncLocalStorage<{ readonly organizationId: string }>();

/**
 * What the provider ties an agent consent to: the organization the person
 * chose, while the gate runs the consent; the unbound reference anywhere
 * else. An application's single sign-on request asks for no agent scope and
 * has no reference, as before.
 */
export function agentConsentReferenceId(info: {
  scopes: readonly string[];
}): string | undefined {
  if (!requestsAgentAccess(info.scopes)) return undefined;
  return (
    chosen.getStore()?.organizationId ??
    `${AGENT_UNBOUND_REFERENCE_PREFIX}${randomUUID()}`
  );
}

/** The consent endpoint's path under the auth mount. */
export const CONSENT_PATH = '/api/auth/oauth2/consent';

/** A consent request is a handful of fields; a body past this is not one
 * this gate can judge, and the provider's own limits apply. */
const CONSENT_BODY_BYTES = 64 * 1024;

/** The session of the person at the consent page, as far as the gate reads
 * it. */
export interface AgentConsentSession {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly emailVerified: boolean;
  };
  readonly session: { readonly createdAt: unknown };
}

export interface AgentConsentDeps {
  readonly sql: Sql;
  /** The person behind the request's session cookie, or null. */
  readonly session: (headers: Headers) => Promise<AgentConsentSession | null>;
  readonly clientIp: () => Promise<string>;
  /** The time, in epoch milliseconds (a test's clock). */
  readonly now?: () => number;
}

/** A refusal the consent page words for the person: a stable code and a
 * sentence, never what was sent. */
function refuse(
  status: 400 | 403 | 503,
  code: string,
  message: string,
  data?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: message, code, ...(data === undefined ? {} : { data }) },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/** When the session began, in epoch milliseconds, or null when the session
 * does not say. */
function startedAt(createdAt: unknown): number | null {
  if (
    createdAt instanceof Date ||
    typeof createdAt === 'string' ||
    typeof createdAt === 'number'
  ) {
    const time = new Date(createdAt).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

/** Where the provider sends the browser, when it answers a consent with
 * the redirect it would have made. */
function redirectOf(body: unknown): URL | null {
  if (
    !isRecord(body) ||
    body.redirect !== true ||
    typeof body.url !== 'string' ||
    !URL.canParse(body.url)
  ) {
    return null;
  }
  return new URL(body.url);
}

/** The host a person is sent back to, as the consent page showed it: the
 * host of a web or loopback address, the scheme of an app's own. */
function redirectHostOf(redirectUri: string | null): string {
  if (redirectUri === null || !URL.canParse(redirectUri)) return 'unknown';
  const url = new URL(redirectUri);
  return url.hostname === '' ? url.protocol : url.hostname;
}

/**
 * The consent of an agent's request, made only for an organization the
 * person may connect an agent to, with access their role there allows.
 * The body names the organization (`tale.organizationId`) beside the
 * provider's own fields; a request that is not for agent access — single
 * sign-on above all — and a refusal of consent reach the provider exactly as
 * they came.
 *
 * Before the provider sees an agent consent:
 *
 * - the person names an organization (`AGENT_CONSENT_ORG_REQUIRED`), is a
 *   member of it (`ORG_FORBIDDEN`) and may connect an agent there
 *   (`AGENT_CONNECT_FORBIDDEN`), with a verified address and no two-factor
 *   enrollment due (`IDENTITY_NOT_ELIGIBLE`);
 * - the access allowed includes reading and testing
 *   (`AGENT_SCOPE_MCP_REQUIRED`) and nothing their role there does not
 *   allow (`AGENT_SCOPE_NOT_ALLOWED`);
 * - access beyond reading and reading settings needs a sign-in from the
 *   last day (`SESSION_NOT_FRESH`).
 *
 * Then the provider makes the consent for that organization, and the
 * connection is recorded before the code is handed over: if it cannot be,
 * the code is never delivered (`AGENT_CONNECTION_UNAVAILABLE`).
 */
export async function agentConsentGate(
  request: Request,
  deps: AgentConsentDeps,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > CONSENT_BODY_BYTES) {
    return handle(request);
  }
  const text = await request.clone().text();
  if (Buffer.byteLength(text) > CONSENT_BODY_BYTES) return handle(request);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    // Not JSON: the provider's own parser refuses it, in its words.
    console.warn(
      '[agent-consent] a consent request whose body is not JSON:',
      error instanceof Error ? error.name : 'unknown',
    );
    return handle(request);
  }
  if (!isRecord(body) || typeof body.oauth_query !== 'string') {
    return handle(request);
  }
  const query = new URLSearchParams(body.oauth_query);
  const requested = scopesOf(query.get('scope'));
  if (!requestsAgentAccess(requested) || body.accept !== true) {
    return handle(request);
  }

  // Everything below is an agent's consent, to be made.
  const signedIn = await deps.session(request.headers);
  if (signedIn === null) return handle(request);
  const { user } = signedIn;
  const named = isRecord(body.tale) ? body.tale.organizationId : undefined;
  if (typeof named !== 'string' || named === '' || named.length > 128) {
    return refuse(
      400,
      'AGENT_CONSENT_ORG_REQUIRED',
      'Choose the organization this agent will work in.',
    );
  }
  const organizationId = named;
  const member = await findOrganizationMember(
    deps.sql,
    organizationId,
    user.id,
  );
  if (member === null || member.role === 'disabled') {
    return refuse(
      403,
      'ORG_FORBIDDEN',
      'You are not a member of this organization.',
    );
  }
  const role = member.role;
  if (
    !user.emailVerified ||
    (await evaluateTwoFactorEnforcement(deps.sql, user.id)).decision ===
      'blocked'
  ) {
    return refuse(
      403,
      'IDENTITY_NOT_ELIGIBLE',
      'This account cannot sign in to an organization yet: verify the email address and finish enrolling in two-factor authentication.',
    );
  }
  if (
    !(await mayConnectAgentIn(deps.sql, {
      organizationId,
      userId: user.id,
      role,
    }))
  ) {
    return refuse(
      403,
      'AGENT_CONNECT_FORBIDDEN',
      'Connecting a coding agent takes the Owner, Admin or Developer role in this organization, or a right an Admin grants for it.',
    );
  }
  const allowed =
    body.scope === undefined
      ? requested
      : typeof body.scope === 'string'
        ? scopesOf(body.scope)
        : null;
  if (
    allowed === null ||
    !allowed.every((scope) => requested.includes(scope))
  ) {
    return Response.json(
      {
        error: 'invalid_request',
        error_description: 'Scope not originally requested',
      },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
  if (!allowed.includes('tale:mcp')) {
    return refuse(
      400,
      'AGENT_SCOPE_MCP_REQUIRED',
      'A coding agent is always allowed to read and test.',
    );
  }
  const ceiling: readonly string[] = scopeCeilingForRole(role);
  const beyond = allowed.filter(
    (scope) => scope !== OFFLINE_ACCESS && !ceiling.includes(scope),
  );
  if (beyond.length > 0) {
    return refuse(
      403,
      'AGENT_SCOPE_NOT_ALLOWED',
      'Your role in this organization does not allow this access.',
      { scopes: beyond },
    );
  }
  const now = (deps.now ?? Date.now)();
  const began = startedAt(signedIn.session.createdAt);
  if (
    needsFreshSession(allowed) &&
    (began === null || now - began >= SESSION_FRESH_AGE_SECONDS * 1000)
  ) {
    return refuse(
      403,
      SESSION_NOT_FRESH_CODE,
      'Confirm your password to allow more than reading and reading settings.',
    );
  }

  // The provider makes the consent for the organization chosen; staying
  // connected is not the person's choice, so a request for it keeps it.
  const accepted = [
    ...allowed.filter((scope) => scope !== OFFLINE_ACCESS),
    ...(requested.includes(OFFLINE_ACCESS) ? [OFFLINE_ACCESS] : []),
  ];
  const { tale: _tale, ...forwarded } = body;
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const answer = await chosen.run({ organizationId }, () =>
    handle(
      new Request(request.url, {
        method: request.method,
        headers,
        body: JSON.stringify({ ...forwarded, scope: accepted.join(' ') }),
      }),
    ),
  );
  if (answer.status !== 200) return answer;
  let answered: unknown;
  try {
    answered = JSON.parse(await answer.clone().text());
  } catch (error) {
    console.warn(
      '[agent-consent] the provider answered a consent with something that is not JSON:',
      error instanceof Error ? error.name : 'unknown',
    );
    return answer;
  }
  const redirect = redirectOf(answered);
  if (redirect === null || !redirect.searchParams.has('code')) return answer;
  try {
    const clientId = query.get('client_id') ?? '';
    const client = agentClientIdentity(
      clientId,
      await readAgentClientRow(deps.sql, clientId),
    );
    const ip = await deps.clientIp();
    const userAgent = request.headers.get('user-agent');
    await connectAgent(deps.sql, {
      organizationId,
      userId: user.id,
      clientId,
      clientName: client.name,
      provenance: client.provenance,
      clientHost: client.host,
      redirectHost: redirectHostOf(query.get('redirect_uri')),
      scopes: accepted.filter(isAgentScope),
      actor: await agentConnectionActor({
        userId: user.id,
        role,
        email: user.email,
        ...(ip === 'unknown' ? {} : { ip }),
        ...(userAgent === null ? {} : { userAgent }),
      }),
    });
  } catch (error) {
    // The code the provider made is never delivered; it expires on its own.
    console.error(
      '[agent-consent] the agent connection could not be recorded:',
      error,
    );
    return refuse(
      503,
      'AGENT_CONNECTION_UNAVAILABLE',
      'The connection could not be made right now. Try again in a moment.',
    );
  }
  return answer;
}
