import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { sandboxDoorBodyLimit } from '../sandbox/door-body-limit.ts';
import { authSessionToken } from './bridge-routes.ts';

/**
 * The in-sandbox connectors bridge as a remote MCP server —
 * `POST /api/connectors/mcp`, MCP's Streamable HTTP transport — for the
 * harnesses whose CLI reaches a remote MCP server itself. It is the stdio
 * relay (`services/sandbox-runtime/tale-connectors-mcp`) moved into the
 * platform, so a turn on such a harness starts no relay process [CONN-R33]:
 *
 *  - the same four tools, with the relay's descriptions and schemas;
 *  - each call goes to the doors the relay calls (`/api/connectors/
 *    {execute,status}`, `/api/tools/{execute,status}`), in process, with the
 *    relay's Authorization header and body, so the grants, the caller, the
 *    in-flight cap and the audit row are theirs;
 *  - each answer is wrapped as the relay wraps it, bounds and texts included.
 *
 * Every request presents the session token itself and is refused without a
 * live one [CONN-R34]. The server keeps no MCP session (no `Mcp-Session-Id`):
 * the token a request carries is its only scope, so no request acts in the
 * scope of another request's token.
 */

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'tale-connectors', version: '1.0.0' };

/** A door the endpoint calls in process: the Hono app of `/api/connectors`
 * or `/api/tools`, which answers `request(path, init)`. */
interface BridgeMcpDoor {
  request: (path: string, init: RequestInit) => Response | Promise<Response>;
}

interface BridgeMcpDeps {
  sql: Sql;
  doors: { connectors: BridgeMcpDoor; tools: BridgeMcpDoor };
  /** The relay's bounds; only tests change them. */
  requestTimeoutMs?: number;
  longRequestTimeoutMs?: number;
  progressIntervalMs?: number;
}

/** The workspace tools that run for minutes: a longer bound, and progress
 * while they run (the relay's `LONG_WORKSPACE_TOOLS`). */
const LONG_WORKSPACE_TOOLS = new Set(['generate_image']);

/** The relay's four tools, word for word: the parity test holds the two
 * lists equal. */
export const BRIDGE_MCP_TOOLS = [
  {
    name: 'connector',
    description:
      "Call an operation on one of the organization's connected connectors " +
      '(for example web search via the "tavily" connector: ' +
      'connector({slug:"tavily", operation:"search", args:{query:"..."}})). ' +
      'If the result has status "unavailable", relay EVERY blocker.guidance ' +
      'message to the user verbatim (a connector may need BOTH enabling for ' +
      'this agent AND a connected credential) — do not retry, and do not try to ' +
      'scrape a search engine via the browser as a substitute. If status is ' +
      '"requires_approval", tell the user to approve the card in the chat.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'The connector slug, e.g. "tavily".',
        },
        operation: {
          type: 'string',
          description: 'The operation name, e.g. "search".',
        },
        args: { type: 'object', description: 'Operation parameters.' },
      },
      required: ['slug', 'operation'],
    },
  },
  {
    name: 'connector_status',
    description:
      "List the organization's connectors and whether each is usable right " +
      'now (boundToAgent + credentialActive). Call this to see what is ' +
      'available before relying on one, and to guide the user to enable/connect ' +
      'any with a non-empty `blockers` array. Always reflects current config.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'workspace_tool',
    description:
      'Call one of the platform workspace tools granted to this agent — the ' +
      "organization's own data (knowledge base, Documents hub, tasks, " +
      'contacts, products, websites), executed by the platform (NOT the local ' +
      'filesystem; files under /user/... are a different, local thing). ' +
      'Example: workspace_tool({tool:"rag_search", args:{query:"..."}}) ' +
      'searches org knowledge; task_find/task_get read the boards, ' +
      'task_create/task_comment/task_update_status/task_upsert_by_external_ref ' +
      'write to them, document_create saves a file to the hub, and ' +
      'generate_image (where the organization allows it) creates images ' +
      'into your workspace. The exact ' +
      'set is per agent — call the separate workspace_status MCP tool with {} ' +
      'to see which tools are ' +
      'granted and their argument shapes. If the result has status ' +
      '"unavailable" or "invalid_args", relay the message to the user and do ' +
      'not retry blindly.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description: 'The workspace tool name, e.g. "rag_search".',
        },
        args: { type: 'object', description: 'Tool arguments.' },
      },
      required: ['tool'],
    },
  },
  {
    name: 'workspace_status',
    description:
      'List the platform workspace tools granted to this agent (each with its ' +
      'argument shape and whether it only reads or also writes). Call this ' +
      'MCP tool directly with {} to discover workspace_tool operations. ' +
      'Discovery requires a live session, not a workspace_status grant. ' +
      'Tools are granted per agent by the ' +
      'user when configuring the agent; an ungranted tool cannot be called. ' +
      'The answer also carries platform.version: the release version the ' +
      'platform backend that answered this call is labelled with (for ' +
      'example "0.5.64"), or null with a note when its build has none; an ' +
      'older platform omits it. It is a label of that backend, not proof ' +
      'of what is deployed or of its health. A live task-agent turn can also ' +
      'return database-validated currentExecution (taskId, agentId, runId, ' +
      'execId and clocks). Null or absent means unknown; never substitute ' +
      'identity from earlier guidance. This read changes no grants and ' +
      'does not authorize a start, command or publication.',
    inputSchema: { type: 'object', properties: {} },
  },
];

type JsonRpcId = string | number;

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rpcResult(id: JsonRpcId, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function rpcResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A tool result the model can read — the relay's `toolText`. */
function toolText(text: string, isError: boolean): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

class DoorTimeout extends Error {}

/**
 * One call to a door, answered as the relay answers its HTTP call: the
 * door's JSON body as text, a non-JSON answer as a sanitized line, and a
 * call past its bound as the relay's timeout line.
 */
async function callDoor(
  door: BridgeMcpDoor,
  path: '/execute' | '/status',
  authorization: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ ok: boolean; text: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(
        door.request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization },
          body: JSON.stringify(body),
        }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DoorTimeout()), timeoutMs);
      }),
    ]);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        text: `connector bridge received a non-JSON response (status ${res.status})`,
      };
    }
    const text = await res.text();
    return { ok: res.ok || res.status === 200, text };
  } catch (error) {
    if (!(error instanceof DoorTimeout)) {
      console.error('[connectors-bridge-mcp] door call failed', error);
    }
    const reason =
      error instanceof DoorTimeout
        ? `timed out after ${timeoutMs}ms`
        : error instanceof Error && error.message !== ''
          ? error.message
          : String(error);
    return { ok: false, text: `connector bridge request failed: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

/** A tool call that needs progress while it runs: a long workspace tool. */
function isLongCall(name: unknown, args: Record<string, unknown>): boolean {
  return (
    name === 'workspace_tool' &&
    typeof args.tool === 'string' &&
    LONG_WORKSPACE_TOOLS.has(args.tool)
  );
}

export function createConnectorBridgeMcpRoutes(deps: BridgeMcpDeps): Hono {
  const requestTimeoutMs = deps.requestTimeoutMs ?? 30_000;
  const longRequestTimeoutMs = deps.longRequestTimeoutMs ?? 300_000;
  const progressIntervalMs = deps.progressIntervalMs ?? 15_000;

  /** The relay's `handleToolCall`, one door call per tool. */
  async function handleToolCall(
    name: unknown,
    args: Record<string, unknown>,
    authorization: string,
  ): Promise<ToolResult> {
    const { connectors, tools } = deps.doors;
    if (name === 'connector') {
      const slug = typeof args.slug === 'string' ? args.slug : '';
      const operation =
        typeof args.operation === 'string' ? args.operation : '';
      const callArgs =
        isRecord(args.args) || Array.isArray(args.args) ? args.args : {};
      if (slug === '' || operation === '') {
        return toolText('Both "slug" and "operation" are required.', true);
      }
      const res = await callDoor(
        connectors,
        '/execute',
        authorization,
        { slug, operation, args: callArgs },
        requestTimeoutMs,
      );
      return toolText(res.text, !res.ok);
    }
    if (name === 'connector_status') {
      const res = await callDoor(
        connectors,
        '/status',
        authorization,
        {},
        requestTimeoutMs,
      );
      return toolText(res.text, !res.ok);
    }
    // Some clients put the discovery tool inside the generic workspace tool:
    // the same read-only call, its arguments dropped.
    if (
      name === 'workspace_status' ||
      (name === 'workspace_tool' && args.tool === 'workspace_status')
    ) {
      const res = await callDoor(
        tools,
        '/status',
        authorization,
        {},
        requestTimeoutMs,
      );
      return toolText(res.text, !res.ok);
    }
    if (name === 'workspace_tool') {
      const tool = typeof args.tool === 'string' ? args.tool : '';
      const callArgs =
        isRecord(args.args) || Array.isArray(args.args) ? args.args : {};
      if (tool === '') {
        return toolText('"tool" is required.', true);
      }
      const res = await callDoor(
        tools,
        '/execute',
        authorization,
        { tool, args: callArgs },
        LONG_WORKSPACE_TOOLS.has(tool)
          ? longRequestTimeoutMs
          : requestTimeoutMs,
      );
      return toolText(res.text, !res.ok);
    }
    return toolText(`Unknown tool: ${String(name)}`, true);
  }

  /**
   * A long call answered as an event stream: a progress notification every
   * interval while it runs (the client restarts its own timeout on each),
   * then the response, then the end of the stream.
   */
  function streamWithProgress(
    id: JsonRpcId,
    progressToken: string | number,
    call: Promise<ToolResult>,
  ): Response {
    const encoder = new TextEncoder();
    const event = (message: unknown) =>
      encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    let timer: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let progress = 0;
        timer = setInterval(() => {
          progress += 1;
          controller.enqueue(
            event({
              jsonrpc: '2.0',
              method: 'notifications/progress',
              params: {
                progressToken,
                progress,
                message: 'The platform is still working on this call.',
              },
            }),
          );
        }, progressIntervalMs);
        void call
          .then(
            (result) => rpcResult(id, result),
            (error: unknown) => {
              console.error('[connectors-bridge-mcp] tool call failed', error);
              return rpcError(id, -32603, 'Internal error.');
            },
          )
          .then((answer) => {
            clearInterval(timer);
            controller.enqueue(event(answer));
            controller.close();
          });
      },
      cancel() {
        clearInterval(timer);
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
    });
  }

  const app = new Hono();
  app.use(
    '*',
    sandboxDoorBodyLimit((message) => rpcError(null, -32600, message)),
  );

  app.post('/', async (c) => {
    const authorization = c.req.header('authorization') ?? '';
    const auth = await authSessionToken(deps.sql, c.req.raw);
    if (auth === null) {
      return rpcResponse(401, rpcError(null, -32001, 'Unauthorized.'));
    }

    let message: unknown;
    try {
      message = JSON.parse(await c.req.text());
    } catch {
      return rpcResponse(400, rpcError(null, -32700, 'Parse error.'));
    }
    if (!isRecord(message)) {
      return rpcResponse(
        400,
        rpcError(
          null,
          -32600,
          Array.isArray(message)
            ? 'Invalid Request: send one message per request.'
            : 'Invalid Request.',
        ),
      );
    }

    const id =
      typeof message.id === 'string' || typeof message.id === 'number'
        ? message.id
        : undefined;
    const method = message.method;
    // A notification, or a response to a request this server never sends:
    // accepted, nothing to answer.
    if (id === undefined || typeof method !== 'string') {
      return new Response(null, { status: 202 });
    }

    if (method === 'initialize') {
      const params = isRecord(message.params) ? message.params : {};
      return rpcResponse(
        200,
        rpcResult(id, {
          protocolVersion:
            typeof params.protocolVersion === 'string'
              ? params.protocolVersion
              : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        }),
      );
    }
    if (method === 'tools/list') {
      return rpcResponse(200, rpcResult(id, { tools: BRIDGE_MCP_TOOLS }));
    }
    if (method === 'ping') {
      return rpcResponse(200, rpcResult(id, {}));
    }
    if (method === 'tools/call') {
      const params = isRecord(message.params) ? message.params : {};
      const args = isRecord(params.arguments) ? params.arguments : {};
      const meta = isRecord(params._meta) ? params._meta : {};
      const progressToken =
        typeof meta.progressToken === 'string' ||
        typeof meta.progressToken === 'number'
          ? meta.progressToken
          : undefined;
      const call = handleToolCall(params.name, args, authorization);
      const acceptsStream = (c.req.header('accept') ?? '').includes(
        'text/event-stream',
      );
      if (
        progressToken !== undefined &&
        acceptsStream &&
        isLongCall(params.name, args)
      ) {
        return streamWithProgress(id, progressToken, call);
      }
      return rpcResponse(200, rpcResult(id, await call));
    }
    return rpcResponse(
      200,
      rpcError(id, -32601, `Method not found: ${method}`),
    );
  });

  // No server-initiated stream and no session to end: POST is the whole
  // transport.
  const postOnly = () =>
    new Response(null, { status: 405, headers: { allow: 'POST' } });
  app.get('/', postOnly);
  app.delete('/', postOnly);

  return app;
}
