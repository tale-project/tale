/**
 * The platform MCP endpoint: everything an outside agent can do here, served as
 * MCP tools over streamable HTTP (JSON responses; no SSE stream is offered).
 *
 * POST /api/v1/mcp with `Authorization: Bearer <org API key>` — the same
 * credential and auth path as every /api/v1 REST surface. The tool inventory
 * (`lib/mcp/tools.ts`) covers two surfaces, and `tools/call` routes by which one
 * owns the name:
 *
 *  - the automation engine's dispatch table — author, validate, test, save,
 *    deploy, run, and then manage what was persisted (runs, versions,
 *    triggers) — through the `'use node'` internal action
 *    (`run_session.dispatchEngineMethod`), which assembles the engine host and
 *    drives `dispatch()` against the org's automation store, live execution
 *    enabled. An MCP call is exactly a builder-session call, never a second
 *    implementation;
 *  - the organization's capability surface — search it, invoke one, retrieve
 *    knowledge — through `chat.capabilities_action.dispatchCapabilityAs`, the
 *    same registry and dispatcher a chat turn uses.
 *
 * Authorization beyond the key: tools that persist or rebind an automation
 * (save, deploy, set_trigger) and tools that start or stop live work resolve
 * the key holder's role and require the developer capability, exactly as the
 * in-app mutations do. The key proves who is calling; the role decides what
 * the call may do.
 *
 * A refusal is never a protocol error. The engine and the capability surface both
 * answer refusals as DATA (`{error, hint}` / `{status: 'refused', reason}`), and
 * those come back as an ordinary tool result so the caller's model can read and
 * act on them; `isError` is reserved for a call that actually threw.
 *
 * Protocol notes: single JSON-RPC message per request (a batch answers -32600),
 * `initialize`/`ping`/`tools/*` only, and notifications get 202 with no body as
 * the streamable-HTTP transport specifies.
 */

import { MCP_TOOLS, mcpToolKind } from '../../lib/mcp/tools';
import { AppError } from '../../lib/shared/errors/app-error';
import { internal } from '../_generated/api';
import {
  jsonError,
  requireRestDeveloper,
  type RestContext,
} from '../lib/rest/helpers';

/** MCP protocol revision this endpoint implements. */
const PROTOCOL_VERSION = '2025-03-26';

/**
 * Tools that persist or rebind an automation. Their in-app equivalents sit
 * behind the developer capability, so an API key meets the same bar here at
 * the endpoint; the engine's own store deliberately leaves save/deploy
 * unchecked because a builder session proves the capability when it starts.
 */
const DEVELOPER_TOOLS: ReadonlySet<string> = new Set([
  'save_automation',
  'deploy_automation',
  'set_trigger',
]);

/** Null when the key holder may persist automations; otherwise the reason,
 * taken from the same role check the in-app mutations apply. Anything that is
 * not a role refusal (an infrastructure failure) re-throws. */
async function developerRefusal(rc: RestContext): Promise<string | null> {
  try {
    await requireRestDeveloper(rc);
    return null;
  } catch (error) {
    if (error instanceof AppError) {
      const data: unknown = error.data;
      return isRecord(data) && typeof data.message === 'string'
        ? data.message
        : 'the key holder lacks the developer capability';
    }
    throw error;
  }
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result });
}

function rpcError(
  id: unknown,
  code: number,
  message: string,
  status = 200,
): Response {
  return Response.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
    { status },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A tool result the caller's model reads as text. Structured content is not
 * offered: the tools answer arbitrary JSON (a run trace, a passage list), and
 * pretty-printed JSON is what every MCP client renders faithfully. */
function toolResult(id: unknown, result: unknown): Response {
  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: false,
  });
}

/**
 * The endpoint's logic, after authentication. Exported so the protocol contract
 * is testable directly — authentication and org resolution are the REST
 * wrapper's job and are covered where they live (`lib/rest/helpers`).
 */
export async function handleMcpRequest(
  rc: RestContext,
  request: Request,
): Promise<Response> {
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return rpcError(null, -32700, 'Parse error: the body is not JSON', 400);
  }
  if (Array.isArray(message)) {
    return rpcError(
      null,
      -32600,
      'Batches are not supported — send one JSON-RPC message per request',
      400,
    );
  }
  if (!isRecord(message)) {
    return rpcError(null, -32600, 'Invalid request', 400);
  }

  const { id, method, params } = message as JsonRpcRequest;
  if (typeof method !== 'string') {
    return rpcError(id, -32600, 'Invalid request: method must be a string');
  }

  // Notifications carry no id and expect no body.
  if (id === undefined && method.startsWith('notifications/')) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'tale-platform',
          title: 'Tale platform',
          version: '1.0.0',
        },
      });

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, {
        tools: MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case 'tools/call': {
      if (!isRecord(params) || typeof params.name !== 'string') {
        return rpcError(id, -32602, 'tools/call needs a string `name`');
      }
      const name = params.name;
      const kind = mcpToolKind(name);
      if (kind === undefined) {
        return rpcError(id, -32602, `Unknown tool "${name}"`);
      }
      const args = isRecord(params.arguments) ? params.arguments : {};
      try {
        if (DEVELOPER_TOOLS.has(name)) {
          const refusal = await developerRefusal(rc);
          if (refusal !== null) {
            return toolResult(id, {
              error: `${name} is refused for this key: ${refusal}`,
              hint: 'saving, deploying and trigger binding need a key whose holder has the developer capability; every read and run tool remains available',
            });
          }
        }
        if (kind === 'capability') {
          const result: unknown = await rc.ctx.runAction(
            internal.chat.capabilities_action.dispatchCapabilityAs,
            {
              organizationId: rc.org.organizationId,
              userId: rc.user.userId,
              method: name,
              params: args,
            },
          );
          return toolResult(id, result);
        }
        const result: unknown = await rc.ctx.runAction(
          internal.automations_builder.run_session.dispatchEngineMethod,
          {
            organizationId: rc.org.organizationId,
            actor: `api-key:${rc.user.userId}`,
            method: name,
            params: args,
          },
        );
        return toolResult(id, result);
      } catch (error) {
        // Only a THROWN failure lands here — a refusal is data and was returned
        // above. Surface the message as a tool error rather than a protocol
        // error, so the client's model can read it and adjust.
        const text = error instanceof Error ? error.message : String(error);
        return rpcResult(id, {
          content: [{ type: 'text', text }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method "${method}" is not supported`);
  }
}

/** GET is not served — this endpoint offers JSON responses, not an SSE stream. */
export function mcpGetNotAllowed(): Response {
  return jsonError('Use POST with a JSON-RPC message', 405);
}
