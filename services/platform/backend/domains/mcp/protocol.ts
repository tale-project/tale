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
 * Resources and prompts (`resources.ts`, `prompts.ts`) are reads the tools
 * already answer: an address is its tool call, through the same checks, and
 * a prompt attaches what it is about with the caller's own rights.
 *
 * Two eras on one endpoint (`eras.ts`): a legacy client (2025-11-25 and
 * before) opens with `initialize` and may send batches; a modern one
 * (2026-07-28) carries its revision and capabilities in every request's
 * `_meta`, learns what the server speaks from `server/discover`
 * (`discover.ts`), sends one message per request, and is answered with
 * `resultType`, the server's name in `_meta` and, where a client may cache,
 * `ttlMs`/`cacheScope`; a method the revision does not have is 404 there,
 * and an address that reads nothing is -32602 instead of -32002.
 *
 * Protocol notes: `initialize`/`ping` (legacy), `server/discover` (modern),
 * `tools/*`/`resources/*`/`prompts/*` (both) only. The envelope is checked
 * before anything is dispatched — a `jsonrpc` other than "2.0" or an id
 * that is not a string or an integer is -32600, and such an id is never
 * echoed back. On the legacy revisions a JSON-RPC batch of at most
 * `MAX_BATCH_MESSAGES` messages is accepted and answered as an array (a
 * batch of notifications alone answers 202), and every tool call, resource
 * read, resource listing or prompt a batch carries beyond the first is
 * admitted through the host's `admit` hook — the REST door charged the HTTP
 * request once, so a batch is never cheaper than the requests it stands
 * for. An unknown tool is -32602; arguments that miss the tool's schema are
 * a tool error (`INVALID_ARGUMENTS`), never a protocol error. A notification
 * gets 202 with no body as the streamable-HTTP transport specifies.
 */

import { randomUUID } from 'node:crypto';

import { SERVER_INSTRUCTIONS } from '../../../lib/mcp/instructions';
import { resourceFreshnessMs } from '../../../lib/mcp/resources';
import {
  MCP_FRESH_FOR_A_LISTING_MS,
  MCP_FRESH_FOR_A_RELEASE_MS,
  MCP_LEGACY_PROTOCOL_VERSIONS,
  MCP_MODERN_PROTOCOL_VERSIONS,
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
import { discoverResult, modernResult } from './discover';
import {
  claimsModernEnvelope,
  type EraHeaders,
  eraHeaders,
  isModernMessage,
  isModernVersion,
  judgeModernRequest,
  META_CLIENT_INFO,
  unsupportedVersion,
} from './eras';
import { getPrompt, listPrompts } from './prompts';
import {
  listResources,
  listResourceTemplates,
  type MethodReply,
  readResource,
} from './resources';
import {
  callTool,
  listTools,
  type McpHost,
  type ToolCallContext,
} from './tools';

/** The revision `initialize` answers when a client proposes one it does not
 * open — the newest initialize-based one. A modern revision is never
 * negotiated there: a modern client does not initialize. */
const LATEST_LEGACY_PROTOCOL_VERSION =
  MCP_LEGACY_PROTOCOL_VERSIONS[0] ?? '2025-11-25';

/** MCP's code for a resource address that reads nothing on the legacy
 * revisions; the modern revision answers -32602 for it. */
const LEGACY_RESOURCE_NOT_FOUND = -32002;

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
   * itself could not be acted on (and, on the modern revision, when its
   * headers or `_meta` could not), 404 for a method the modern revision
   * does not have, 200 for every other answer to a well-formed request — a
   * JSON-RPC error included. A batch always answers 200. */
  readonly status: 200 | 400 | 404;
  /** How the call went, for the call record — set where the JSON-RPC
   * envelope alone does not say (a tool result flagged `isError`, a fault
   * answered as -32603). */
  readonly outcome?: { outcome: McpCallOutcome; code?: string };
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcReply {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  status: 200 | 400 | 404 = 200,
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
  /** Calls that reach a surface — tool calls, resource reads and listings,
   * prompts — answered so far. */
  calls: number;
  /** The HTTP request's id — the door's `X-Request-Id`, or one minted here
   * for a caller that came without (a test, a future door). */
  readonly requestId: string;
}

/** The name a client gave itself on one message: in every modern
 * request's `_meta`, on a legacy one's `initialize`. */
function clientNameOf(
  params: Record<string, unknown>,
  method: string,
): string | null {
  const meta = isRecord(params._meta) ? params._meta : {};
  const modern = meta[META_CLIENT_INFO];
  if (isRecord(modern)) return displayClientName(modern.name);
  return method === 'initialize' && isRecord(params.clientInfo)
    ? displayClientName(params.clientInfo.name)
    : null;
}

/**
 * What the call record says of one answered message: its method, the tool a
 * `tools/call` named when the inventory holds it (a name a client invented
 * is never recorded), how it went, and the name the client gave itself —
 * on every modern request, on a legacy `initialize`. Never an argument.
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
    reply.outcome ??
    (isRecord(error)
      ? { outcome: 'refused', code: String(error.code) }
      : { outcome: 'ok' });
  const clientName = clientNameOf(params, method);
  return {
    method,
    ...(tool === undefined ? {} : { tool }),
    ...outcome,
    ms,
    ...(clientName === null ? {} : { clientName }),
  };
}

/**
 * The admission of one call that reaches a surface: the door charged the
 * HTTP request itself, so the first call of a request is free here and every
 * further one a batch carries is charged through the host's hook.
 */
function admission(
  options: McpRequestOptions,
  state: RequestState,
): () => Promise<{ retryAfterMs: number } | null> {
  return async () => {
    if (state.calls > 0 && options.admit !== undefined) {
      const wait = await options.admit();
      if (wait !== null) return wait;
    }
    state.calls += 1;
    return null;
  };
}

/** What a call that reaches a surface runs with: the host, the request id,
 * the execution budget and this request's admission. */
function surfaceContext(
  options: McpRequestOptions,
  state: RequestState,
): ToolCallContext {
  return {
    host: options.host,
    requestId: state.requestId,
    ...(options.charge === undefined ? {} : { charge: options.charge }),
    admit: admission(options, state),
  };
}

/** The refusal of a batch call whose request budget is spent. */
function budgetSpent(id: JsonRpcId, retryAfterMs: number): JsonRpcReply {
  return rpcError(
    id,
    -32000,
    `Rate limit exceeded — this batch has spent the key holder's request budget; retry after ${Math.ceil(retryAfterMs / 1000)} s`,
    200,
    { retryAfterMs },
  );
}

/** A resource or prompt method's answer as its JSON-RPC reply. */
function methodReply<T>(id: JsonRpcId, reply: MethodReply<T>): JsonRpcReply {
  if (reply.kind === 'admission') return budgetSpent(id, reply.retryAfterMs);
  if (reply.kind === 'result') return rpcResult(id, reply.result);
  const { code, message, data, outcome } = reply.error;
  return {
    ...rpcError(id, code, message, 200, data),
    outcome: { outcome, code: String(code) },
  };
}

/** One JSON-RPC message → its reply (null for a notification), told to the
 * door's observer when its method is one the endpoint serves. `modern`
 * carries the request's protocol headers when the message is served on the
 * modern revision, null on the legacy ones. */
async function handleMessage(
  caller: McpCaller,
  message: unknown,
  options: McpRequestOptions,
  state: RequestState,
  modern: EraHeaders | null,
): Promise<JsonRpcReply | null> {
  const started = performance.now();
  const reply = await answerMessage(caller, message, options, state, modern);
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

/** A checked JSON-RPC envelope: an id (absent for a notification), a
 * method, and params that are an object, an array or absent. */
interface Envelope {
  readonly id: JsonRpcId | undefined;
  readonly method: string;
  readonly params: unknown;
}

/** The envelope of one message, or the -32600 its shape is refused with —
 * the same on both revisions. */
function readEnvelope(message: unknown): Envelope | JsonRpcReply {
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
  return { id, method, params };
}

/** One JSON-RPC message → its reply, or null for a notification (a message
 * without an id is acknowledged, never answered). */
async function answerMessage(
  caller: McpCaller,
  message: unknown,
  options: McpRequestOptions,
  state: RequestState,
  modern: EraHeaders | null,
): Promise<JsonRpcReply | null> {
  const envelope = readEnvelope(message);
  if ('body' in envelope) return envelope;
  const { id, method, params } = envelope;
  if (id === undefined) return null;
  if (modern !== null) {
    return answerModern(caller, id, method, params, modern, options, state);
  }
  const reply = await serveMethod(
    'legacy',
    caller,
    id,
    method,
    params,
    options,
    state,
  );
  return reply ?? rpcError(id, -32601, `Method "${method}" is not supported`);
}

/**
 * One modern request: judged before anything runs (`eras.ts` — the
 * headers, the envelope, the revision; each refusal HTTP 400), served as the
 * client it names itself on this request, and answered the modern way —
 * complete, naming the server, with cache hints where a client may cache, a
 * method the revision lacks as 404, and an address that reads nothing as
 * -32602.
 */
async function answerModern(
  caller: McpCaller,
  id: JsonRpcId,
  method: string,
  params: unknown,
  headers: EraHeaders,
  options: McpRequestOptions,
  state: RequestState,
): Promise<JsonRpcReply> {
  const verdict = judgeModernRequest(method, params, headers);
  if (verdict.kind === 'refused') {
    return rpcError(id, verdict.code, verdict.message, 400, verdict.data);
  }
  // The name rides every modern request, so the audit rows and the version
  // this call writes can name the client.
  const acting: McpCaller =
    verdict.clientName === null
      ? caller
      : { ...caller, clientName: verdict.clientName };
  const reply = await serveMethod(
    'modern',
    acting,
    id,
    method,
    params,
    options,
    state,
  );
  if (reply === null) {
    return rpcError(id, -32601, removedMethod(method, verdict.version), 404);
  }
  const { result, error } = reply.body;
  if (result !== undefined) {
    return {
      ...reply,
      body: {
        ...reply.body,
        result: modernResult(result, freshnessOf(method, params)),
      },
    };
  }
  if (isRecord(error) && error.code === LEGACY_RESOURCE_NOT_FOUND) {
    return {
      ...reply,
      body: { ...reply.body, error: { ...error, code: -32602 } },
      ...(reply.outcome === undefined
        ? {}
        : { outcome: { ...reply.outcome, code: '-32602' } }),
    };
  }
  return reply;
}

/** Why a modern request's method is not served. */
function removedMethod(method: string, version: string): string {
  if (method === 'initialize') {
    return `Method "initialize" is not part of ${version}: a request that carries its revision in _meta needs no handshake — call server/discover to learn what this server speaks`;
  }
  if (method === 'ping') return `Method "ping" was removed in ${version}`;
  return `Method "${method.slice(0, 64)}" is not supported`;
}

/** How long a client may keep a modern answer, for the methods whose answer
 * it may cache; undefined for the rest. */
function freshnessOf(method: string, params: unknown): number | undefined {
  switch (method) {
    case 'server/discover':
    case 'tools/list':
    case 'prompts/list':
    case 'resources/templates/list':
      return MCP_FRESH_FOR_A_RELEASE_MS;
    case 'resources/list':
      return MCP_FRESH_FOR_A_LISTING_MS;
    case 'resources/read':
      return resourceFreshnessMs(
        isRecord(params) && typeof params.uri === 'string' ? params.uri : '',
      );
    default:
      return undefined;
  }
}

/**
 * One method of either revision → its reply, or null when the revision has
 * no such method: `initialize` and `ping` are the legacy revisions' only,
 * `server/discover` the modern one's; tools, resources and prompts are
 * served the same on both.
 */
async function serveMethod(
  era: 'legacy' | 'modern',
  caller: McpCaller,
  id: JsonRpcId,
  method: string,
  params: unknown,
  options: McpRequestOptions,
  state: RequestState,
): Promise<JsonRpcReply | null> {
  switch (method) {
    case 'initialize': {
      if (era === 'modern') return null;
      const proposed = isRecord(params) ? params.protocolVersion : undefined;
      return rpcResult(id, {
        protocolVersion:
          typeof proposed === 'string' &&
          MCP_LEGACY_PROTOCOL_VERSIONS.includes(proposed)
            ? proposed
            : LATEST_LEGACY_PROTOCOL_VERSION,
        capabilities: MCP_SERVER_CAPABILITIES,
        serverInfo: MCP_SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }

    case 'ping':
      return era === 'modern' ? null : rpcResult(id, {});

    case 'server/discover':
      return era === 'legacy' ? null : rpcResult(id, discoverResult());

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
      // Charged once its arguments hold (`callTool`).
      const reply = await callTool(
        caller,
        tool,
        params.arguments,
        surfaceContext(options, state),
      );
      if (reply.kind === 'admission') {
        return budgetSpent(id, reply.retryAfterMs);
      }
      const { result, outcome, code } = reply.answer;
      return {
        ...rpcResult(id, result),
        outcome: { outcome, ...(code === undefined ? {} : { code }) },
      };
    }

    case 'resources/list':
      return methodReply(
        id,
        await listResources(
          caller,
          isRecord(params) ? params.cursor : undefined,
          surfaceContext(options, state),
        ),
      );

    case 'resources/templates/list':
      // Answered whole, like tools/list: a cursor was never issued.
      if (isRecord(params) && params.cursor !== undefined) {
        return rpcError(
          id,
          -32602,
          'Invalid params: this server answers resources/templates/list whole and never issues a cursor',
        );
      }
      return rpcResult(id, listResourceTemplates());

    case 'resources/read':
      return methodReply(
        id,
        await readResource(
          caller,
          isRecord(params) ? params.uri : undefined,
          surfaceContext(options, state),
        ),
      );

    case 'prompts/list':
      if (isRecord(params) && params.cursor !== undefined) {
        return rpcError(
          id,
          -32602,
          'Invalid params: this server answers prompts/list whole and never issues a cursor',
        );
      }
      return rpcResult(id, listPrompts());

    case 'prompts/get':
      return methodReply(
        id,
        await getPrompt(
          caller,
          isRecord(params) ? params : {},
          surfaceContext(options, state),
        ),
      );

    default:
      return null;
  }
}

function respond(reply: JsonRpcReply): Response {
  return Response.json(reply.body, { status: reply.status });
}

/** The refusal of a request whose `MCP-Protocol-Version` header names a
 * revision this endpoint does not speak — with the message's own id when it
 * has one (null for a batch). */
function unsupportedHeader(message: unknown, claimed: string): Response {
  const echoed =
    isRecord(message) && isJsonRpcId(message.id) ? message.id : null;
  const { code, message: text, data } = unsupportedVersion(claimed);
  return respond(rpcError(echoed, code, text, 400, data));
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
  const headers = eraHeaders(request.headers);
  const claimed = headers.protocolVersion;
  const state: RequestState = {
    calls: 0,
    requestId: caller.requestId ?? randomUUID(),
  };
  if (Array.isArray(message)) {
    // A legacy client names its negotiated revision on every request from
    // 2025-06-18 on; one this endpoint never negotiates is a client mistake
    // the transport answers with 400. Older clients send nothing.
    if (claimed !== null && !MCP_PROTOCOL_VERSIONS.includes(claimed)) {
      return unsupportedHeader(message, claimed);
    }
    // A modern request is one message per POST; a batch that names the
    // modern revision anywhere is refused whole, as MCP's own SDK does, so
    // no message of it runs on the wrong revision's rules.
    if (isModernVersion(claimed) || message.some(claimsModernEnvelope)) {
      return respond(
        rpcError(
          null,
          -32600,
          `Invalid request: a ${MCP_MODERN_PROTOCOL_VERSIONS.join(', ')} request carries one message — batches are answered only on ${MCP_LEGACY_PROTOCOL_VERSIONS.join(', ')}`,
          400,
        ),
      );
    }
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
      const reply = await handleMessage(caller, entry, options, state, null);
      if (reply !== null) replies.push(reply.body);
    }
    return replies.length === 0
      ? new Response(null, { status: 202 })
      : Response.json(replies);
  }
  // The body decides the era: a message whose `_meta` names a revision, or
  // whose header names a modern one, is served on the modern revision's
  // rules (`eras.ts`); everything else as before. The body is read first so
  // a refusal can echo the message's own id — a client matching replies by
  // id used to get `null`.
  const modern = isModernMessage(message, headers);
  if (!modern && claimed !== null && !MCP_PROTOCOL_VERSIONS.includes(claimed)) {
    return unsupportedHeader(message, claimed);
  }
  const reply = await handleMessage(
    caller,
    message,
    options,
    state,
    modern ? headers : null,
  );
  return reply === null ? new Response(null, { status: 202 }) : respond(reply);
}
