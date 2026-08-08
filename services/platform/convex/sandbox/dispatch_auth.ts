/**
 * Shared bearer auth for the in-sandbox dispatch HTTP surfaces
 * (`/api/connectors/*` and `/api/tools/*`).
 *
 * The MCP bridge presents the per-session gateway virtual key (already in the
 * container env) as `Authorization: Bearer <vk>`. We hash it (sha256, matching
 * `hashVirtualKey`) and look it up in sandboxSessionTokens; organizationId and
 * every grant/context field come FROM THAT ROW, never from the request body —
 * a container cannot spoof another org, widen its own grants, or claim
 * another thread/user (red-team M1).
 */

import { internal } from '../_generated/api';
import type { httpAction } from '../_generated/server';

const BEARER_PREFIX = 'Bearer ';

/** The ctx an httpAction handler receives (structural; shared by both
 * dispatch files without re-deriving the parameter type in each). */
export type DispatchHttpCtx = Parameters<Parameters<typeof httpAction>[0]>[0];

export interface SessionDispatchAuth {
  organizationId: string;
  sessionId: string;
  /** Connector-bridge grant set (`scope.connectorGrants` — the agent's
   * connectorBindings). */
  connectorGrants: string[];
  /** Workspace-tool grant set (`scope.toolGrants` — the agent's `toolNames`).
   * Pre-feature token rows lack the field: absent = none granted. */
  toolGrants: string[];
  /** Workspace-tool execution context, present on external-agent chat turns
   * only — the turn's agent / thread / user, read from the token scope so the
   * dispatch can synthesize a server-trusted ToolCtx. */
  agentSlug?: string;
  threadId?: string;
  userId?: string;
  /** The gateway virtual-key id the token row was minted with. The work lanes
   * mint one VK per TURN and stamp the same id on the turn's session-op row
   * (`mintedKeyId`), so this is the dispatch's server-trusted link to the exec
   * it serves — the provenance ledger's per-run read-set attribution. Absent
   * on tokens minted without a gateway key (e.g. BYO serving). */
  llmGatewayKeyId?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Resolve the session from the bearer token. Returns null on ANY auth failure
 * (missing/garbage header, unknown hash, revoked, expired) — callers map null
 * to 401.
 */
export async function authSessionToken(
  ctx: DispatchHttpCtx,
  req: Request,
): Promise<SessionDispatchAuth | null> {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await ctx.runQuery(
    internal.sandbox.session_queries.getSessionTokenByHash,
    { tokenHash },
  );
  if (!row) return null;
  if (row.revokedAt !== undefined) return null;
  if (row.expiresAt <= Date.now()) return null;
  return {
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    connectorGrants: row.scope.connectorGrants,
    toolGrants: row.scope.toolGrants ?? [],
    ...(row.scope.agentSlug !== undefined && {
      agentSlug: row.scope.agentSlug,
    }),
    ...(row.scope.threadId !== undefined && { threadId: row.scope.threadId }),
    ...(row.scope.userId !== undefined && { userId: row.scope.userId }),
    ...(row.llmGatewayKeyId !== undefined && {
      llmGatewayKeyId: row.llmGatewayKeyId,
    }),
  };
}
