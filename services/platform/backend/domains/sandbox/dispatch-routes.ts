import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import type { Sql } from 'postgres';

import {
  dispatchWorkspaceToolImpl,
  workspaceToolStatusImpl,
} from '../../core/node_only/sandbox/workspace_tools_bridge.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { getSessionTokenByHash } from './sessions.ts';
import { sandboxToolShimHandlers } from './shim.ts';

/**
 * The in-sandbox WORKSPACE-TOOL dispatch surface —
 * `POST /api/tools/{execute,status}` — the 0.5 twin of
 * `convex/sandbox/tools_http.ts`, with the SAME contract the baked
 * `tale-connectors-mcp` bridge speaks: `{tool, args}` in, a structured JSON
 * status body out (only an auth failure answers non-2xx, because the body
 * is relayed verbatim to the model as tool-result text).
 *
 * Auth: `Authorization: Bearer <session VK>` → sha256 → the session-token
 * row; the org, user, and grant set come FROM THAT ROW, never the body — a
 * container cannot spoof another org, widen its grants, or claim another
 * thread/user. The dispatch itself is the REUSED bridge running on the ctx
 * shim.
 */

const BEARER_PREFIX = 'Bearer ';

interface DispatchAuth {
  organizationId: string;
  sessionId: string;
  toolGrants: string[];
  userId?: string;
  mintedKeyId?: string;
}

async function authSessionToken(
  sql: Sql,
  request: Request,
): Promise<DispatchAuth | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = await getSessionTokenByHash(sql, tokenHash);
  if (row === null) return null;
  return {
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    toolGrants: row.scope.toolGrants ?? [],
    ...(row.scope.userId !== undefined ? { userId: row.scope.userId } : {}),
    ...(row.llmGatewayKeyId !== null
      ? { mintedKeyId: row.llmGatewayKeyId }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createToolDispatchRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.post('/execute', async (c) => {
    const auth = await authSessionToken(deps.sql, c.req.raw);
    if (auth === null) {
      return c.json({ status: 'error', message: 'Unauthorized.' }, 401);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        status: 'invalid_args',
        message: 'The request body must be JSON: {tool, args}.',
      });
    }
    const tool =
      isRecord(body) && typeof body.tool === 'string' ? body.tool : '';
    const callArgs = isRecord(body) && isRecord(body.args) ? body.args : {};
    if (tool === '') {
      return c.json({
        status: 'invalid_args',
        message: 'A "tool" name is required.',
      });
    }
    if (!auth.toolGrants.includes(tool)) {
      return c.json({
        status: 'unavailable',
        blockers: [
          {
            code: 'not_granted',
            guidance:
              `The workspace tool "${tool}" is not granted to this agent. ` +
              'Call workspace_status to see what is available.',
          },
        ],
      });
    }
    const shim = createCtxShim(sandboxToolShimHandlers(deps.sql));
    const result = await dispatchWorkspaceToolImpl(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 bridge; every ctx facility it touches is covered by sandboxToolShimHandlers
      shim as unknown as Parameters<typeof dispatchWorkspaceToolImpl>[0],
      {
        organizationId: auth.organizationId,
        sessionId: auth.sessionId,
        ...(auth.userId !== undefined ? { userId: auth.userId } : {}),
        ...(auth.mintedKeyId !== undefined
          ? { mintedKeyId: auth.mintedKeyId }
          : {}),
        tool,
        callArgs,
      },
    );
    return c.json(result);
  });

  app.post('/status', async (c) => {
    const auth = await authSessionToken(deps.sql, c.req.raw);
    if (auth === null) {
      return c.json({ status: 'error', message: 'Unauthorized.' }, 401);
    }
    return c.json(workspaceToolStatusImpl(auth.toolGrants));
  });

  return app;
}
