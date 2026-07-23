/**
 * The platform MCP endpoint: the engine's 12-method dispatch, served as MCP
 * tools over streamable HTTP (JSON responses; no SSE stream is offered).
 *
 * POST /api/v1/mcp with `Authorization: Bearer <org API key>` — the same
 * credential and auth path as every /api/v1 REST surface. Each engine method
 * is one MCP tool; `tools/call` delegates to the `'use node'` internal action
 * (`run_session.dispatchEngineMethod`), which assembles the engine host and
 * drives `dispatch()` against the org's automation store — so an MCP call is
 * exactly a builder-session call with live execution enabled, never a second
 * implementation.
 *
 * Protocol notes: single JSON-RPC message per request (a batch answers
 * -32600), `initialize`/`ping`/`tools/*` only, and notifications get 202 with
 * no body as the streamable-HTTP transport specifies.
 */

import { METHODS } from '../../lib/engine/api/dispatch';
import { internal } from '../_generated/api';
import { jsonError, withRestAuth } from '../lib/rest/helpers';

/** MCP protocol revision this endpoint implements. */
const PROTOCOL_VERSION = '2025-03-26';

/** One-line tool descriptions; `get_docs` is the deep reference. */
const METHOD_DESCRIPTIONS: Record<(typeof METHODS)[number], string> = {
  get_docs: 'The workflow grammar and authoring guide, as text.',
  get_catalog: 'Every node type this deployment can execute.',
  search_catalog: 'Search the node-type catalog by keyword.',
  validate_workflow: 'Validate a workflow document without saving it.',
  run_workflow: 'Run a workflow document directly (mock or live mode).',
  test_workflow: "Run a workflow's own acceptance tests.",
  save_workflow: 'Save a workflow document as a new immutable version.',
  get_workflow: 'Read one saved version (the latest when unversioned).',
  list_workflows: "The organization's automations with their latest versions.",
  deploy_workflow: 'Promote one saved version to be the live version.',
  set_trigger: 'Bind what starts the automation (schedule/webhook/event).',
  run_deployed: 'Run the deployed version of an automation, live.',
};

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

export const mcpHandler = withRestAuth('rest:api', async (rc, request) => {
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
          name: 'tale-automations',
          title: 'Tale automations',
          version: '1.0.0',
        },
      });

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, {
        tools: METHODS.map((name) => ({
          name,
          description: METHOD_DESCRIPTIONS[name],
          // The engine validates params itself and refuses with a hint;
          // `get_docs` is the schema reference, so the wire schema stays open.
          inputSchema: { type: 'object' },
        })),
      });

    case 'tools/call': {
      if (!isRecord(params) || typeof params.name !== 'string') {
        return rpcError(id, -32602, 'tools/call needs a string `name`');
      }
      const name = params.name;
      if (!(METHODS as readonly string[]).includes(name)) {
        return rpcError(id, -32602, `Unknown tool "${name}"`);
      }
      const args = isRecord(params.arguments) ? params.arguments : {};
      try {
        const result: unknown = await rc.ctx.runAction(
          internal.automations_builder.run_session.dispatchEngineMethod,
          {
            organizationId: rc.org.organizationId,
            actor: `api-key:${rc.user.userId}`,
            method: name,
            params: args,
          },
        );
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (error) {
        // The engine refuses with structured messages; surface them as a tool
        // error (isError) rather than a protocol error, so the client's model
        // can read and act on the refusal.
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
});

/** GET is not served — this endpoint offers JSON responses, not an SSE stream. */
export const mcpMethodNotAllowed = withRestAuth('rest:api', async () => {
  return jsonError('Use POST with a JSON-RPC message', 405);
});
