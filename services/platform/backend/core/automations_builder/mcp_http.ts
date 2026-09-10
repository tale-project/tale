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
 * call did not do its job — a refusal, a missing resource, a knowledge base
 * that could not be searched — and on a call that threw. A capability that
 * is waiting for a human's approval is an outcome, not a failure, and keeps
 * the flag off.
 *
 * Protocol notes: `initialize`/`ping`/`tools/*` only. The envelope is checked
 * before anything is dispatched — a `jsonrpc` other than "2.0" or an id that
 * is not a string or a number is -32600, and such an id is never echoed
 * back. A JSON-RPC batch is accepted and answered as an array (a batch of
 * notifications alone answers 202), tool arguments are held to the input
 * schema `tools/list` advertised (-32602), and a notification gets 202 with
 * no body as the streamable-HTTP transport specifies.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

import { MCP_TOOLS } from '../../../lib/mcp/tools';
import { AppError } from '../../../lib/shared/errors/app-error';
import { internal } from '../lib/handler_names';
import {
  jsonError,
  requireRestDeveloper,
  type RestContext,
} from '../lib/rest/helpers';

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

/** A JSON-RPC request id: a string or a number. Anything else cannot be
 * represented in a conforming reply, so it is refused rather than echoed. */
type JsonRpcId = string | number;

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
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
): JsonRpcReply {
  return { status, body: { jsonrpc: '2.0', id, error: { code, message } } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a tool's answer says the call did not do its job: the engine's
 * refusal envelope carries a top-level string `error` (a run view's failure
 * detail is an object, so a read that succeeded is not mistaken for one),
 * and a capability backend that could not act answers `status:
 * 'unavailable'`. A `refused` capability is a human's approval pending — an
 * outcome the caller waits on, not a failure. */
function isFailureShaped(result: unknown): boolean {
  if (!isRecord(result)) return false;
  return typeof result.error === 'string' || result.status === 'unavailable';
}

/** A tool result the caller's model reads as text. Structured content is not
 * offered: the tools answer arbitrary JSON (a run trace, a passage list), and
 * pretty-printed JSON is what every MCP client renders faithfully. */
function toolResult(id: JsonRpcId, result: unknown): JsonRpcReply {
  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: isFailureShaped(result),
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

/** One JSON-RPC message → its reply, or null for a notification (a message
 * without an id is acknowledged, never answered). */
async function handleMessage(
  rc: RestContext,
  message: unknown,
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
      'Invalid request: id must be a string or a number',
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
): Promise<Response> {
  // 2025-06-18 clients name the negotiated revision on every request; one
  // this endpoint never negotiates is a client mistake the transport answers
  // with 400, as that revision specifies. Older clients send nothing.
  const claimed = request.headers.get('mcp-protocol-version');
  if (claimed !== null && !PROTOCOL_VERSIONS.includes(claimed)) {
    return respond(
      rpcError(
        null,
        -32600,
        `Unsupported MCP-Protocol-Version "${claimed}" — this endpoint speaks ${PROTOCOL_VERSIONS.join(' and ')}`,
        400,
      ),
    );
  }
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return respond(
      rpcError(null, -32700, 'Parse error: the body is not JSON', 400),
    );
  }
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return respond(
        rpcError(null, -32600, 'Invalid request: an empty batch', 400),
      );
    }
    // In order, one after another: a batch may carry calls that depend on
    // each other's side effects, and replies are matched by id regardless.
    const replies: Record<string, unknown>[] = [];
    for (const entry of message) {
      const reply = await handleMessage(rc, entry);
      if (reply !== null) replies.push(reply.body);
    }
    return replies.length === 0
      ? new Response(null, { status: 202 })
      : Response.json(replies);
  }
  const reply = await handleMessage(rc, message);
  return reply === null ? new Response(null, { status: 202 }) : respond(reply);
}

/** GET is not served — this endpoint offers JSON responses, not an SSE stream. */
export function mcpGetNotAllowed(): Response {
  return jsonError('Use POST with a JSON-RPC message', 405);
}
