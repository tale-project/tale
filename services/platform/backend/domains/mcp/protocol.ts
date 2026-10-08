/**
 * The platform MCP endpoint: everything an outside agent can do here, served as
 * MCP tools over streamable HTTP (JSON responses; no SSE stream is offered).
 *
 * POST /api/v1/mcp with `Authorization: Bearer <org API key>` — the same
 * credential and auth path as every /api/v1 REST surface; the door hands this
 * layer the proven caller (`caller.ts`). The tool inventory
 * (`lib/mcp/tools.ts`) covers two surfaces, and `tools/call` routes by which one
 * owns the name, through the host the door binds (`engine-host.ts`):
 *
 *  - the automation engine's dispatch table — author, validate, test, save,
 *    deploy, run, and then manage what was persisted (runs, versions,
 *    triggers) — driven by `dispatch()` against the org's automation store
 *    with live execution enabled. This is the same authoring/validation host
 *    used by the app's editor;
 *  - the organization's capability surface — search it, invoke one, retrieve
 *    knowledge — through `dispatchCapabilityAs`, the same registry and
 *    dispatcher a chat turn uses.
 *
 * Every `tools/call` goes through `tools.ts`: the arguments are checked
 * against the tool's schema (every problem at once, as one tool error), the
 * role the tool needs is checked, the surface runs it, and a refusal —
 * answered or thrown — comes back as data the caller's model can read and
 * act on, flagged `isError` whenever the call did not do its job. A fault is
 * `INTERNAL_ERROR` with the request id. The key proves who is calling; the
 * role decides what the call may do.
 *
 * Protocol notes: `initialize`/`ping`/`tools/*` only. The envelope is checked
 * before anything is dispatched — a `jsonrpc` other than "2.0" or an id that
 * is not a string or an integer is -32600, and such an id is never echoed
 * back. A JSON-RPC batch of at most `MAX_BATCH_MESSAGES` messages is accepted
 * and answered as an array (a batch of notifications alone answers 202), and
 * every tool call a batch carries beyond the first is admitted through the
 * host's `admit` hook — the REST door charged the HTTP request once, so a
 * batch is never cheaper than the requests it stands for. An unknown tool is
 * -32602; arguments that miss the tool's schema are a tool error
 * (`INVALID_ARGUMENTS`), never a protocol error. A notification gets 202
 * with no body as the streamable-HTTP transport specifies.
 */

import { randomUUID } from 'node:crypto';

import { SERVER_INSTRUCTIONS } from '../../../lib/mcp/instructions';
import {
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_CAPABILITIES,
  MCP_SERVER_INFO,
} from '../../../lib/mcp/server';
import { MCP_TOOLS, findMcpTool } from '../../../lib/mcp/tools';
import { displayClientName } from '../../../lib/shared/client-name';
import {
  INEXACT_NUMBER_MESSAGE,
  parseJsonExact,
} from '../../../lib/utils/json-exact';
import {
  isRecordedMethod,
  type McpCallOutcome,
  type McpCallRecord,
} from './activity';
import type { McpCaller } from './caller';
import {
  callTool,
  listTools,
  type McpHost,
  type ToolCallContext,
} from './tools';

/** The revision `initialize` answers when a client proposes one this
 * endpoint does not speak — the newest it does. */
const LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0] ?? '2025-11-25';

/** The JSON-RPC code a request naming an unsupported revision gets: MCP's
 * `UnsupportedProtocolVersion`, which a client that speaks several
 * revisions recognises and retries on, with `data.supported` to choose
 * from. */
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** How many messages one batch may carry. 2025-03-26 requires receiving
 * batches and says nothing about their size; without a cap one HTTP request
 * could carry any number of tool dispatches. */
export const MAX_BATCH_MESSAGES = 20;

/** A JSON-RPC request id as MCP restricts it: a string or an integer. A
 * fraction, an object or an array cannot be represented in a conforming
 * reply, so it is refused rather than echoed. */
type JsonRpcId = string | number;

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || Number.isInteger(value);
}

interface JsonRpcReply {
  readonly body: Record<string, unknown>;
  /** The HTTP status a SINGLE message answers with: 400 when the envelope
   * itself could not be acted on, 200 for every answer to a well-formed
   * request — a JSON-RPC error included. A batch always answers 200. */
  readonly status: 200 | 400;
  /** How a tool call went, for the call record — set on a tool result. */
  readonly toolOutcome?: { outcome: McpCallOutcome; code?: string };
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcReply {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  status: 200 | 400 = 200,
  data?: Record<string, unknown>,
): JsonRpcReply {
  return {
    status,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --------------------------------------------------------------- dispatch

export interface McpRequestOptions {
  readonly host: McpHost;
  /** Called before every tool call in a request AFTER the first — the door
   * charged the HTTP request itself, so each further dispatch a batch
   * carries is charged here. Null admits the call; a wait refuses that call
   * alone (-32000 with `data.retryAfterMs`) while the rest of the batch goes
   * on. */
  readonly admit?: () => Promise<{ retryAfterMs: number } | null>;
  /** Draws one execution for a tool that executes an automation, after its
   * role check (`tools.ts`); a wait refuses that call as `RATE_LIMITED`. */
  readonly charge?: ToolCallContext['charge'];
  /** Told of every answered request message whose method the endpoint
   * serves — never of a notification, and never what the call carried.
   * The door counts it (`activity.ts`); awaited, so the count is true when
   * the answer leaves. */
  readonly observe?: (record: McpCallRecord) => Promise<void>;
}

/** What one request has spent so far — shared by the messages of a batch. */
interface RequestState {
  toolCalls: number;
  /** The HTTP request's id — the door's `X-Request-Id`, or one minted here
   * for a caller that came without (a test, a future door). */
  readonly requestId: string;
}

/**
 * What the call record says of one answered message: its method, the tool a
 * `tools/call` named when the inventory holds it (a name a client invented
 * is never recorded), how it went, and on `initialize` the name the client
 * gave itself. Never an argument.
 */
function callRecord(
  message: Record<string, unknown>,
  method: McpCallRecord['method'],
  reply: JsonRpcReply,
  ms: number,
): McpCallRecord {
  const params = isRecord(message.params) ? message.params : {};
  const named = params.name;
  const tool =
    method === 'tools/call' &&
    typeof named === 'string' &&
    MCP_TOOLS.some((candidate) => candidate.name === named)
      ? named
      : undefined;
  const error = reply.body.error;
  const outcome: { outcome: McpCallOutcome; code?: string } =
    reply.toolOutcome ??
    (isRecord(error)
      ? { outcome: 'refused', code: String(error.code) }
      : { outcome: 'ok' });
  const clientName =
    method === 'initialize' && isRecord(params.clientInfo)
      ? displayClientName(params.clientInfo.name)
      : null;
  return {
    method,
    ...(tool === undefined ? {} : { tool }),
    ...outcome,
    ms,
    ...(clientName === null ? {} : { clientName }),
  };
}

/** One JSON-RPC message → its reply (null for a notification), told to the
 * door's observer when its method is one the endpoint serves. */
async function handleMessage(
  caller: McpCaller,
  message: unknown,
  options: McpRequestOptions,
  state: RequestState,
): Promise<JsonRpcReply | null> {
  const started = performance.now();
  const reply = await answerMessage(caller, message, options, state);
  if (
    reply !== null &&
    options.observe !== undefined &&
    isRecord(message) &&
    typeof message.method === 'string' &&
    isRecordedMethod(message.method)
  ) {
    await options.observe(
      callRecord(message, message.method, reply, performance.now() - started),
    );
  }
  return reply;
}

/** One JSON-RPC message → its reply, or null for a notification (a message
 * without an id is acknowledged, never answered). */
async function answerMessage(
  caller: McpCaller,
  message: unknown,
  options: McpRequestOptions,
  state: RequestState,
): Promise<JsonRpcReply | null> {
  if (!isRecord(message)) {
    return rpcError(
      null,
      -32600,
      'Invalid request: a JSON-RPC message is an object',
      400,
    );
  }
  const { jsonrpc, id, method, params } = message;
  if (jsonrpc !== '2.0') {
    return rpcError(
      isJsonRpcId(id) ? id : null,
      -32600,
      'Invalid request: jsonrpc must be "2.0"',
      400,
    );
  }
  if (id !== undefined && !isJsonRpcId(id)) {
    return rpcError(
      null,
      -32600,
      'Invalid request: id must be a string or an integer',
      400,
    );
  }
  if (typeof method !== 'string') {
    return rpcError(
      id ?? null,
      -32600,
      'Invalid request: method must be a string',
      400,
    );
  }
  // JSON-RPC 2.0 §4.2: `params` is a structured value — an object or an
  // array — or absent. A scalar used to be refused only where a method
  // happened to read it (`tools/call` needs an object) and silently
  // ignored elsewhere.
  if (params !== undefined && !isRecord(params) && !Array.isArray(params)) {
    return rpcError(
      id ?? null,
      -32600,
      'Invalid request: params must be an object or an array',
      400,
    );
  }
  if (id === undefined) return null;

  switch (method) {
    case 'initialize': {
      const proposed = isRecord(params) ? params.protocolVersion : undefined;
      return rpcResult(id, {
        protocolVersion:
          typeof proposed === 'string' &&
          MCP_PROTOCOL_VERSIONS.includes(proposed)
            ? proposed
            : LATEST_PROTOCOL_VERSION,
        capabilities: MCP_SERVER_CAPABILITIES,
        serverInfo: MCP_SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      // The list is answered whole: no cursor is ever issued, so one that
      // arrives was never ours — refused, not silently read as page one.
      if (isRecord(params) && params.cursor !== undefined) {
        return rpcError(
          id,
          -32602,
          'Invalid params: this server answers tools/list whole and never issues a cursor',
        );
      }
      return rpcResult(id, { tools: listTools() });

    case 'tools/call': {
      if (!isRecord(params) || typeof params.name !== 'string') {
        return rpcError(id, -32602, 'tools/call needs a string `name`');
      }
      const tool = findMcpTool(params.name);
      if (tool === undefined) {
        return rpcError(id, -32602, `Unknown tool "${params.name}"`);
      }
      const reply = await callTool(caller, tool, params.arguments, {
        host: options.host,
        requestId: state.requestId,
        ...(options.charge === undefined ? {} : { charge: options.charge }),
        // The door charged the HTTP request itself; every further call a
        // batch carries is charged here, once its arguments hold.
        admit: async () => {
          if (state.toolCalls > 0 && options.admit !== undefined) {
            const wait = await options.admit();
            if (wait !== null) return wait;
          }
          state.toolCalls += 1;
          return null;
        },
      });
      if (reply.kind === 'admission') {
        return rpcError(
          id,
          -32000,
          `Rate limit exceeded — this batch has spent the key holder's request budget; retry after ${Math.ceil(reply.retryAfterMs / 1000)} s`,
          200,
          { retryAfterMs: reply.retryAfterMs },
        );
      }
      const { result, outcome, code } = reply.answer;
      return {
        ...rpcResult(id, result),
        toolOutcome: { outcome, ...(code === undefined ? {} : { code }) },
      };
    }

    default:
      return rpcError(id, -32601, `Method "${method}" is not supported`);
  }
}

function respond(reply: JsonRpcReply): Response {
  return Response.json(reply.body, { status: reply.status });
}

/**
 * The endpoint's logic, after authentication. Exported so the protocol contract
 * is testable directly — authentication and org resolution are the REST
 * door's job (`backend/rest/v1.ts` + `backend/rest/v1-mcp.ts`) and are
 * covered where they live.
 */
export async function handleMcpRequest(
  caller: McpCaller,
  request: Request,
  options: McpRequestOptions,
): Promise<Response> {
  let message: unknown;
  try {
    // The REST body's own parser: a whole number beyond ±(2^53 − 1) is
    // rounded by `JSON.parse` before anything reads it, so an `id` of
    // 9007199254740993 was echoed as …992 and a client keying replies on
    // 64-bit ids never matched one (2026-09-19 evaluation, K8-2). Such a
    // literal is a request this transport cannot answer faithfully —
    // refused as an invalid request naming the literal, the way the REST
    // door names it, never rounded and echoed.
    const parsed = parseJsonExact(await request.text());
    if (!parsed.exact) {
      return respond(
        rpcError(
          null,
          -32600,
          `Invalid request: ${parsed.path === '' ? 'the body' : `"${parsed.path}"`} ${INEXACT_NUMBER_MESSAGE}`,
          400,
        ),
      );
    }
    message = parsed.value;
  } catch {
    return respond(
      rpcError(null, -32700, 'Parse error: the body is not JSON', 400),
    );
  }
  // 2025-06-18 and later clients name the negotiated revision on every
  // request; one this endpoint never negotiates is a client mistake the
  // transport answers with 400. Older clients send nothing. The body is
  // read first so the refusal can echo the message's own id (null for a
  // batch) — a client matching replies by id used to get `null`.
  const claimed = request.headers.get('mcp-protocol-version');
  if (claimed !== null && !MCP_PROTOCOL_VERSIONS.includes(claimed)) {
    const echoed =
      isRecord(message) && isJsonRpcId(message.id) ? message.id : null;
    return respond(
      rpcError(
        echoed,
        UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version "${claimed}" — this endpoint speaks ${MCP_PROTOCOL_VERSIONS.join(', ')}`,
        400,
        { supported: [...MCP_PROTOCOL_VERSIONS], requested: claimed },
      ),
    );
  }
  const state: RequestState = {
    toolCalls: 0,
    requestId: caller.requestId ?? randomUUID(),
  };
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return respond(
        rpcError(null, -32600, 'Invalid request: an empty batch', 400),
      );
    }
    if (message.length > MAX_BATCH_MESSAGES) {
      return respond(
        rpcError(
          null,
          -32600,
          `Invalid request: a batch carries at most ${MAX_BATCH_MESSAGES} messages`,
          400,
        ),
      );
    }
    // In order, one after another: a batch may carry calls that depend on
    // each other's side effects, and replies are matched by id regardless.
    const replies: Record<string, unknown>[] = [];
    for (const entry of message) {
      const reply = await handleMessage(caller, entry, options, state);
      if (reply !== null) replies.push(reply.body);
    }
    return replies.length === 0
      ? new Response(null, { status: 202 })
      : Response.json(replies);
  }
  const reply = await handleMessage(caller, message, options, state);
  return reply === null ? new Response(null, { status: 202 }) : respond(reply);
}
