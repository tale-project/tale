/**
 * Who one MCP request acts as.
 *
 * The REST door (`backend/rest/v1.ts`) proves everything before the MCP
 * route runs: the bearer verified as a key, the organization the key holder
 * named (or their only one), and a live membership in it, with the member's
 * role read for this request. A key whose holder left the organization or
 * was disabled never reaches this module — the door answers 403.
 *
 * The caller carries those facts into the protocol layer as one value, so
 * nothing past the door reads the request context again: the developer gate
 * reads `role`, the engine records `api-key:<userId>` and the key on the runs
 * it starts, and the capability surface acts as `userId`.
 */

import type { Context } from 'hono';

import { requestIdOf } from '../../error-reporting.ts';
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
}

/** The caller of one authenticated `/api/v1/mcp` request. */
export function callerFromRest(c: Context<RestEnv>): McpCaller {
  const apiKeyId = restApiKeyId(c);
  const requestId = requestIdOf(c);
  return {
    organizationId: c.get('organizationId'),
    orgSlug: c.get('orgSlug'),
    userId: c.get('userId'),
    role: c.get('role'),
    credential: {
      kind: 'api-key',
      ...(apiKeyId !== undefined ? { apiKeyId } : {}),
    },
    ...(requestId !== undefined ? { requestId } : {}),
  };
}
