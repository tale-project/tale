/**
 * Who one MCP request acts as.
 *
 * The REST door (`backend/rest/v1.ts`) proves everything before the MCP
 * route runs: the bearer verified as a key — or as the access token of a
 * coding agent's connection (`rest/agent-door.ts`) — the organization the
 * key holder named (or their only one, or the one the connection was made
 * for), and a live membership in it, with the member's role read for this
 * request. A key whose holder left the organization or was disabled never
 * reaches this module — the door answers 403.
 *
 * The caller carries those facts into the protocol layer as one value, so
 * nothing past the door reads the request context again: the developer gate
 * reads `role`, the engine records `api-key:<userId>` and the key on the runs
 * it starts, and the capability surface acts as `userId`.
 */

import type { Context } from 'hono';

import { requestIdOf } from '../../error-reporting.ts';
import { mcpOrigin, type WriteOrigin } from '../../lib/write-origin.ts';
import {
  restApiKeyId,
  type RestCredential,
  type RestEnv,
} from '../../rest/shared.ts';

export interface McpCaller {
  readonly organizationId: string;
  readonly orgSlug: string;
  readonly userId: string;
  /** The caller's member role in the organization, as the door read it for
   * this request — never cached across requests. */
  readonly role: string;
  readonly credential: RestCredential;
  /** The request id the app stamped (`X-Request-Id`), when there is one. */
  readonly requestId?: string;
  /** The name the caller's client gave itself for this request, through
   * `displayClientName` — untrusted, display only. Absent on a request
   * that names none: a legacy client names itself only on `initialize`. */
  readonly clientName?: string;
}

/** The caller of one authenticated `/api/v1/mcp` request. */
export function callerFromRest(c: Context<RestEnv>): McpCaller {
  const requestId = requestIdOf(c);
  return {
    organizationId: c.get('organizationId'),
    orgSlug: c.get('orgSlug'),
    userId: c.get('userId'),
    role: c.get('role'),
    credential: credentialFromRest(c),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

/** What the door proved the request with: the coding agent's connection
 * when it came with an access token, else the API key. */
function credentialFromRest(c: Context<RestEnv>): RestCredential {
  const connection = c.get('agentConnection');
  if (connection !== undefined) return { kind: 'agent', ...connection };
  const apiKeyId = restApiKeyId(c);
  // A key made for someone or something else says so: what it reaches ends
  // at its own organization (`domains/api_keys/owners.ts`).
  const owner = c.get('apiKeyOwner')?.kind;
  return {
    kind: 'api-key',
    ...(apiKeyId !== undefined ? { apiKeyId } : {}),
    ...(owner !== undefined ? { owner } : {}),
  };
}

/** The API key the call came with, by id — none for a coding agent's
 * connection, which is not a key. */
export function callerApiKeyId(caller: McpCaller): string | undefined {
  return caller.credential.kind === 'api-key'
    ? caller.credential.apiKeyId
    : undefined;
}

/**
 * Who the caller's writes are, through which door: the person through their
 * key or their agent's connection (`api-key:<userId>` either way — the door
 * a write came through is `mcp`, and the connection is named beside it),
 * with the client the request named. The engine store records it on what a
 * definition write changes, and the tool call's request channel is opened
 * from it, so the audit rows of the call and the version it saves name the
 * same key or connection and client. A request that names no client is
 * attributed to the app the person connected, when there is one.
 */
export function callerOrigin(caller: McpCaller): WriteOrigin {
  const { credential } = caller;
  return mcpOrigin({
    userId: caller.userId,
    ...(credential.kind === 'agent'
      ? { agentConnectionId: credential.connectionId }
      : { apiKeyId: credential.apiKeyId }),
    clientName:
      caller.clientName ??
      (credential.kind === 'agent' ? credential.clientName : undefined),
  });
}
