/**
 * Workspace-tool dispatch HTTP surface — the endpoints the in-container MCP
 * bridge calls so a sandboxed external agent can use the platform tools its
 * config grants (`toolNames` ⊆ EXTERNAL_AGENT_TOOL_NAMES) WITHOUT any
 * platform credential entering the container.
 *
 *   POST /api/tools/execute  body {tool, args}
 *   POST /api/tools/status   (no body)
 *
 * Auth mirrors /api/integrations/*: the bridge presents the per-session VK;
 * the grant set AND the execution context (agent/thread/user) come from the
 * token row's scope (dispatch_auth.ts), never from the request body.
 *
 * Execution reuses the LOOP'S OWN tool implementations from the registry: the
 * ToolCtx the loop would inject is synthesized here from the session scope
 * (+ the agent's knowledge scope, re-resolved from its config), so every
 * tool-internal authorization check — same-org floors, thread-scoped file
 * access, reserved-tag stripping, approval creation on writes — applies
 * unchanged. Results are NOT blanket-wrapped as untrusted (unlike the
 * integration dispatch, whose results are third-party data): workspace tools
 * apply the loop's own trust calculus internally and already wrap the parts
 * that need it (e.g. rag_search wraps video-link transcripts).
 *
 * Every non-`ok` result is HTTP 200 with a structured body (never an isError
 * the model retry-loops on), so the agent relays the guidance instead.
 */

import { EXTERNAL_AGENT_TOOL_NAMES } from '../../lib/shared/schemas/agents';
import { getString, isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { rateLimiter } from '../lib/rate_limiter';
import { authSessionToken } from '../sandbox/dispatch_auth';
import { getToolRegistryMap } from './tool_registry';
import type { ToolDefinition } from './types';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Structural view of a createTool() result — the registry types tools as
 * `unknown`; the dispatch needs the zod input schema and the ctx-reading
 * execute (`getCtx(this)` reads `this.ctx`, so a spread-with-ctx clone is the
 * SDK's own injection contract, same as its `wrapTools`). */
interface DispatchableTool {
  /** Injection slot read by createTool's `getCtx(this)`. */
  ctx?: unknown;
  inputSchema?: {
    safeParse?: (value: unknown) => {
      success: boolean;
      data?: unknown;
      error?: { issues?: Array<{ path?: PropertyKey[]; message?: string }> };
    };
  };
  execute?: (
    input: unknown,
    options: { toolCallId: string; messages: never[] },
  ) => Promise<unknown>;
}

/** Bound wording shared by both "not a workspace tool" and "not granted" so
 * the agent gets one actionable sentence either way. */
function unavailableMessage(tool: string, granted: string[]): string {
  const grantedList =
    granted.length > 0 ? granted.join(', ') : 'none granted to this agent';
  return (
    `"${tool}" is not available here (workspace tools: ${grantedList}). ` +
    'Only the tools listed by workspace_status can be called; to enable ' +
    "more, the user binds them on the agent's Tools tab."
  );
}

export const executeToolHandler = httpAction(async (ctx, req) => {
  const auth = await authSessionToken(ctx, req);
  if (!auth) return json(401, { status: 'error', message: 'unauthorized' });

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return json(400, { status: 'error', message: 'invalid JSON body' });
  }
  const body: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  const tool = getString(body, 'tool') ?? '';
  if (!tool) {
    return json(400, { status: 'error', message: '"tool" is required' });
  }
  const args: Record<string, unknown> = isRecord(body.args) ? body.args : {};

  // Best-effort forensic audit (mirrors the integration dispatch): a
  // transient audit failure must never turn an executed call into an error.
  const audit = async (outcome: string) => {
    try {
      await ctx.runMutation(
        internal.agent_tools.dispatch_internal.recordToolCall,
        {
          organizationId: auth.organizationId,
          sessionId: auth.sessionId,
          tool,
          outcome,
          paramsFingerprint: Object.keys(args).sort().join(','),
          ...(auth.userId !== undefined && { userId: auth.userId }),
        },
      );
    } catch (err) {
      console.warn(
        `[tools/dispatch] audit write failed for ${tool} (${outcome}):`,
        err,
      );
    }
  };

  // Grant + registry gates. The grant set was snapshotted from the agent's
  // `toolNames` at token mint; the registry marking is the compiled-in truth
  // of what is bridgeable — both must agree (defense in depth: a stale grant
  // from a since-narrowed subset dies here).
  const registry: Partial<Record<string, ToolDefinition>> =
    getToolRegistryMap();
  const def = registry[tool];
  if (!auth.toolGrants.includes(tool) || def?.sandboxBridge !== true) {
    await audit('unavailable');
    return json(200, {
      status: 'unavailable',
      tool,
      message: unavailableMessage(tool, auth.toolGrants),
    });
  }

  // Per-session throttle on the otherwise-unmetered dispatch surface.
  const rl = await rateLimiter.limit(ctx, 'tools:dispatch', {
    key: auth.sessionId,
  });
  if (!rl.ok) {
    await audit('rate_limited');
    return json(429, {
      status: 'error',
      message: 'workspace-tool calls are rate limited; slow down and retry',
      retryAfterMs: rl.retryAfter,
    });
  }

  // Validate the args against the tool's own zod schema — the loop's model
  // boundary normally does this; the dispatch is the boundary here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- registry tools are createTool() results; the registry types them `unknown`
  const toolImpl = def.tool as DispatchableTool;
  let input: unknown = args;
  const schema = toolImpl.inputSchema;
  if (schema && typeof schema.safeParse === 'function') {
    const result = schema.safeParse(args);
    if (!result.success) {
      await audit('invalid_args');
      const issues = (result.error?.issues ?? [])
        .slice(0, 5)
        .map((i) => `${(i.path ?? []).join('.')}: ${i.message ?? 'invalid'}`)
        .join('; ');
      return json(200, {
        status: 'invalid_args',
        tool,
        message: `arguments did not match the ${tool} schema — ${issues}`,
      });
    }
    input = result.data;
  }

  // Synthesize the ToolCtx the loop would inject. organizationId/threadId/
  // userId come from the token scope (server-trusted); the agent's knowledge
  // scope is re-resolved fresh from its config file so rag_search sees the
  // same allow-list as a loop turn would. A resolve failure degrades to "no
  // knowledge scope" (the tool then reports an empty knowledge base) rather
  // than failing the call.
  let knowledgeCtx: Record<string, unknown> = {};
  if (auth.agentSlug !== undefined) {
    try {
      knowledgeCtx = await ctx.runAction(
        internal.node_only.sandbox.workspace_tool_context
          .resolveWorkspaceToolContext,
        { organizationId: auth.organizationId, agentSlug: auth.agentSlug },
      );
    } catch (err) {
      console.warn(
        `[tools/dispatch] knowledge-scope resolve failed for ${auth.agentSlug}:`,
        err,
      );
    }
  }
  const toolCtx = {
    ...ctx,
    organizationId: auth.organizationId,
    ...(auth.threadId !== undefined && { threadId: auth.threadId }),
    ...(auth.userId !== undefined && { userId: auth.userId }),
    ...knowledgeCtx,
  };

  try {
    // `{...tool, ctx}` is the SDK's own ctx-injection contract (wrapTools):
    // createTool's execute reads `this.ctx`.
    const bound: DispatchableTool = { ...toolImpl, ctx: toolCtx };
    if (typeof bound.execute !== 'function') {
      await audit('error');
      return json(200, {
        status: 'error',
        tool,
        message: `${tool} has no execute handler`,
      });
    }
    const result = await bound.execute(input, {
      toolCallId: `sandbox-dispatch:${crypto.randomUUID()}`,
      messages: [],
    });

    if (isRecord(result) && result.requiresApproval === true) {
      await audit('requires_approval');
      const approvalId =
        typeof result.approvalId === 'string' ? result.approvalId : undefined;
      return json(200, {
        status: 'requires_approval',
        tool,
        ...(approvalId ? { approvalId } : {}),
        message:
          `"${tool}" is a write operation and needs user approval. It has ` +
          'been surfaced as an approval card in the chat — tell the user to ' +
          'approve it there; it will run automatically once approved.',
      });
    }

    await audit('ok');
    return json(200, { status: 'ok', tool, result });
  } catch (err) {
    await audit('error');
    const message = err instanceof Error ? err.message : String(err);
    // Bound any echoed value (same posture as the integration dispatch).
    return json(200, {
      status: 'error',
      tool,
      message: message.slice(0, 500),
    });
  }
});

export const toolStatusHandler = httpAction(async (ctx, req) => {
  const auth = await authSessionToken(ctx, req);
  if (!auth) return json(401, { status: 'error', message: 'unauthorized' });
  const registry: Partial<Record<string, ToolDefinition>> =
    getToolRegistryMap();
  const tools = EXTERNAL_AGENT_TOOL_NAMES.map((name) => ({
    tool: name,
    granted:
      auth.toolGrants.includes(name) && registry[name]?.sandboxBridge === true,
  }));
  return json(200, {
    tools,
    ...(tools.every((t) => !t.granted) && {
      message:
        'No workspace tools are granted to this agent. The user can enable ' +
        "them on the agent's Tools tab.",
    }),
  });
});
