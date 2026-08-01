/**
 * The in-sandbox WORKSPACE-TOOL dispatch surface —
 * `POST /api/tools/{execute,status}` — the platform end of the baked
 * `tale-connectors-mcp` bridge's `workspace_tool`/`workspace_status` face.
 * The first-party sibling of `connectors_http.ts`.
 *
 * Contract (fixed by the shim shipped in the sandbox image — it derives this
 * base URL from the connectors one, `…/api/connectors` → `…/api/tools`, so
 * no image rebuild and no second env var):
 *   execute: body `{tool, args}` → JSON status body
 *   status:  body `{}`           → JSON listing body
 * Auth: `Authorization: Bearer <session VK>` → `authSessionToken` resolves the
 * token row's org + user + `toolGrants`; NOTHING is trusted from the body. The
 * response is relayed verbatim to the agent as tool-result text, so every
 * branch answers structured JSON; only an auth failure uses a non-2xx status.
 */

import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { authSessionToken } from './dispatch_auth';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const toolsExecuteHandler = httpAction(async (ctx, request) => {
  const auth = await authSessionToken(ctx, request);
  if (auth === null) {
    return json(401, { status: 'error', message: 'Unauthorized.' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(200, {
      status: 'invalid_args',
      message: 'The request body must be JSON: {tool, args}.',
    });
  }
  const tool = isRecord(body) && typeof body.tool === 'string' ? body.tool : '';
  const callArgs = isRecord(body) && isRecord(body.args) ? body.args : {};
  if (tool === '') {
    return json(200, {
      status: 'invalid_args',
      message: 'A "tool" name is required.',
    });
  }

  // The grant set comes from the session token row — what this agent was
  // equipped with at provisioning, never the request.
  if (!auth.toolGrants.includes(tool)) {
    return json(200, {
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
  // Whether a tool needs the turn's user is per-tool: the org-data READS
  // refuse without one inside the dispatch, while `ask_human` (an automation
  // run's tool — its token carries no user) runs on the session alone.
  const result: unknown = await ctx.runAction(
    internal.node_only.sandbox.workspace_tools_bridge.dispatchWorkspaceTool,
    {
      organizationId: auth.organizationId,
      sessionId: auth.sessionId,
      ...(auth.userId !== undefined ? { userId: auth.userId } : {}),
      tool,
      callArgs,
    },
  );
  return json(200, result);
});

export const toolsStatusHandler = httpAction(async (ctx, request) => {
  const auth = await authSessionToken(ctx, request);
  if (auth === null) {
    return json(401, { status: 'error', message: 'Unauthorized.' });
  }
  const result: unknown = await ctx.runAction(
    internal.node_only.sandbox.workspace_tools_bridge.workspaceToolStatus,
    { grants: auth.toolGrants },
  );
  return json(200, result);
});
