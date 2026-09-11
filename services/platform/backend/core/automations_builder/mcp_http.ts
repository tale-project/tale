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
 * A refusal is never a protocol error. The engine and the capability surface
 * both answer refusals as DATA (`{error, hint}` / `{status: 'refused'}`), and
 * those come back as an ordinary tool result so the caller's model can read
 * and act on them. The result's `isError` flag tells a generic client the
 * same thing without parsing the text: it is set whenever the answer says the
 * call did not do its job — an engine refusal or missing resource (a top-level
 * string `error`), a capability that was refused (an unknown id, arguments
 * its schema rejects, no deployment) or could not act (`unavailable`), a run
 * tool whose run ended in `error` or `invalid` — and on a call that threw. A
 * capability that answers `pending` (a memory saved for a human's approval)
 * and a read that found a failed run are outcomes, not failures, and keep the
 * flag off.
 *
 * Protocol notes: `initialize`/`ping`/`tools/*` only. The envelope is checked
 * before anything is dispatched — a `jsonrpc` other than "2.0" or an id that
 * is not a string or an integer is -32600, and such an id is never echoed
 * back. A JSON-RPC batch of at most `MAX_BATCH_MESSAGES` messages is accepted
 * and answered as an array (a batch of notifications alone answers 202), and
 * every tool call a batch carries beyond the first is admitted through the
 * host's `admit` hook — the REST door charged the HTTP request once, so a
 * batch is never cheaper than the requests it stands for. Tool arguments are
 * held to the input schema `tools/list` advertised (-32602), and a
 * notification gets 202 with no body as the streamable-HTTP transport
 * specifies.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

import { MCP_TOOLS } from '../../../lib/mcp/tools';
import { AppError } from '../../../lib/shared/errors/app-error';
import { internal } from '../lib/handler_names';
import { requireRestDeveloper, type RestContext } from '../lib/rest/helpers';

type McpTool = (typeof MCP_TOOLS)[number];

/**
 * The protocol revisions this endpoint speaks, newest first. `initialize`
 * echoes the client's proposal when it is one of these and answers the
 * newest otherwise — the lifecycle's rule for a proposal the server lacks.
 * Both fit a JSON-only tools server: 2025-03-26 requires receiving batches,
 * which the transport does; 2025-06-18 dropped batching and added the
 * `MCP-Protocol-Version` request header, which is checked on every request.
 */
const PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26'];
const LATEST_PROTOCOL_VERSION = '2025-06-18';

/** How many messages one batch may carry. 2025-03-26 requires receiving
 * batches and says nothing about their size; without a cap one HTTP request
 * could carry any number of tool dispatches. */
export const MAX_BATCH_MESSAGES = 20;

/** The tools that EXECUTE an automation: their answer's `status` is the run's
 * own outcome, so `error` / `invalid` there means the call did not do its job.
 * A READ of a run (`get_run`) that found a failed run succeeded. */
const RUN_TOOLS: ReadonlySet<string> = new Set([
  'run_automation',
  'run_deployed',
]);

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

/** Whether a tool's answer says the call did not do its job — the shapes the
 * two surfaces use for that, per tool: the engine's refusal envelope is a
 * top-level string `error` (a run view's failure detail is an object, so a
 * read that succeeded is not mistaken for one); a capability answers
 * `refused` (an unknown id, arguments its schema rejects, a backend that
 * would not act) or `unavailable` (a knowledge base it could not search),
 * while `pending` — a memory saved for a human's approval — is an outcome;
 * a run tool's `status` is the run's own, so `error` / `invalid` there is the
 * call failing at what it was asked to do. */
function isFailureShaped(tool: McpTool, result: unknown): boolean {
  if (!isRecord(result)) return false;
  if (typeof result.error === 'string') return true;
  if (tool.kind === 'capability') {
    return result.status === 'refused' || result.status === 'unavailable';
  }
  if (RUN_TOOLS.has(tool.name)) {
    return result.status === 'error' || result.status === 'invalid';
  }
  return false;
}

/** A tool result the caller's model reads as text. Structured content is not
 * offered: the tools answer arbitrary JSON (a run trace, a passage list), and
 * pretty-printed JSON is what every MCP client renders faithfully. */
function toolResult(
  tool: McpTool,
  id: JsonRpcId,
  result: unknown,
): JsonRpcReply {
  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: isFailureShaped(tool, result),
  });
}

// ------------------------------------------------------ argument validation

const ajv = new Ajv({ allErrors: false, strict: false });
const validators = new Map<string, ValidateFunction>();

function describeIssue(issue: ErrorObject): string {
  const where =
    issue.instancePath === ''
      ? 'arguments'
      : `arguments${issue.instancePath.replace(/\//g, '.')}`;
  if (issue.keyword === 'additionalProperties') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ajv's params for this keyword
    const extra = (issue.params as { additionalProperty?: unknown })
      .additionalProperty;
    return `${where} has an unexpected property "${String(extra)}"`;
  }
  return `${where} ${issue.message ?? 'does not match the schema'}`;
}

/** Null when the arguments satisfy the input schema `tools/list` advertised
 * for this tool; otherwise what is wrong, for the -32602 the caller gets
 * instead of a "successful" call that never ran the query it meant — a
 * missing required `query` used to read as an empty search. */
function argumentProblem(
  name: string,
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): string | null {
  let validate = validators.get(name);
  if (validate === undefined) {
    validate = ajv.compile(schema);
    validators.set(name, validate);
  }
  if (validate(args)) return null;
  const issue = validate.errors?.[0];
  return issue === undefined
    ? 'the arguments do not match the tool schema'
    : describeIssue(issue);
}

// --------------------------------------------------------------- dispatch

export interface McpRequestOptions {
  /** Called before every tool call in a request AFTER the first — the door
   * charged the HTTP request itself, so each further dispatch a batch
   * carries is charged here. Null admits the call; a wait refuses that call
   * alone (-32000 with `data.retryAfterMs`) while the rest of the batch goes
   * on. */
  readonly admit?: () => Promise<{ retryAfterMs: number } | null>;
}

/** What one request has spent so far — shared by the messages of a batch. */
interface RequestState {
  toolCalls: number;
}

/** One JSON-RPC message → its reply, or null for a notification (a message
 * without an id is acknowledged, never answered). */
async function handleMessage(
  rc: RestContext,
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
          typeof proposed === 'string' && PROTOCOL_VERSIONS.includes(proposed)
            ? proposed
            : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'tale-platform',
          title: 'Tale platform',
          version: '1.0.0',
        },
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
      const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
      if (tool === undefined) {
        return rpcError(id, -32602, `Unknown tool "${name}"`);
      }
      const rawArgs = params.arguments;
      if (rawArgs !== undefined && !isRecord(rawArgs)) {
        return rpcError(id, -32602, 'tools/call `arguments` must be an object');
      }
      const args = rawArgs ?? {};
      const problem = argumentProblem(tool.name, tool.inputSchema, args);
      if (problem !== null) {
        return rpcError(
          id,
          -32602,
          `Invalid arguments for "${name}": ${problem}`,
        );
      }
      if (state.toolCalls > 0 && options.admit !== undefined) {
        const wait = await options.admit();
        if (wait !== null) {
          return rpcError(
            id,
            -32000,
            `Rate limit exceeded — this batch has spent the key holder's request budget; retry after ${Math.ceil(wait.retryAfterMs / 1000)} s`,
            200,
            { retryAfterMs: wait.retryAfterMs },
          );
        }
      }
      state.toolCalls += 1;
      try {
        if (DEVELOPER_TOOLS.has(name)) {
          const refusal = await developerRefusal(rc);
          if (refusal !== null) {
            return toolResult(tool, id, {
              error: `${name} is refused for this key: ${refusal}`,
              hint: 'saving, deploying and trigger binding need a key whose holder has the developer capability; every read and run tool remains available',
            });
          }
        }
        if (tool.kind === 'capability') {
          const result: unknown = await rc.ctx.runAction(
            internal.chat.capabilities_action.dispatchCapabilityAs,
            {
              organizationId: rc.org.organizationId,
              userId: rc.user.userId,
              method: name,
              params: args,
            },
          );
          return toolResult(tool, id, result);
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
        return toolResult(tool, id, result);
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
  rc: RestContext,
  request: Request,
  options: McpRequestOptions = {},
): Promise<Response> {
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return respond(
      rpcError(null, -32700, 'Parse error: the body is not JSON', 400),
    );
  }
  // 2025-06-18 clients name the negotiated revision on every request; one
  // this endpoint never negotiates is a client mistake the transport answers
  // with 400, as that revision specifies. Older clients send nothing. The
  // body is read first so the refusal can echo the message's own id (null
  // for a batch) — a client matching replies by id used to get `null`.
  const claimed = request.headers.get('mcp-protocol-version');
  if (claimed !== null && !PROTOCOL_VERSIONS.includes(claimed)) {
    const echoed =
      isRecord(message) && isJsonRpcId(message.id) ? message.id : null;
    return respond(
      rpcError(
        echoed,
        -32600,
        `Unsupported MCP-Protocol-Version "${claimed}" — this endpoint speaks ${PROTOCOL_VERSIONS.join(' and ')}`,
        400,
      ),
    );
  }
  const state: RequestState = { toolCalls: 0 };
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
      const reply = await handleMessage(rc, entry, options, state);
      if (reply !== null) replies.push(reply.body);
    }
    return replies.length === 0
      ? new Response(null, { status: 202 })
      : Response.json(replies);
  }
  const reply = await handleMessage(rc, message, options, state);
  return reply === null ? new Response(null, { status: 202 }) : respond(reply);
}

/** Only POST is served — this endpoint offers JSON responses, not an SSE
 * stream, and holds no session to DELETE. The 405 names the one verb it
 * takes (RFC 9110 §15.5.6) in the door's flat envelope, with no CORS
 * grant: a Bearer key is not ambient authority a browser page could use. */
export function mcpGetNotAllowed(): Response {
  return Response.json(
    {
      error: 'Use POST with a JSON-RPC message',
      code: 'METHOD_NOT_ALLOWED',
    },
    { status: 405, headers: { allow: 'POST' } },
  );
}
