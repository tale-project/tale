/**
 * The MCP endpoint's tools: what `tools/list` advertises, and what one
 * `tools/call` goes through before and after the surface that answers it.
 *
 * A call, in order: the tool is found (an unknown name is a protocol error,
 * the protocol layer's), its arguments are checked against the tool's zod
 * schema — every problem at once, as one tool error the agent can read
 * (`INVALID_ARGUMENTS`) —, the role the tool needs is checked, then the
 * surface runs it inside a request channel (its audit rows name the door),
 * and the answer is shaped. A refusal is data: whether the surface answered
 * it (`{error, code, hint}`) or threw it (a store's `AutomationError`, an
 * `AppError`), the agent reads its code and its own sentence — never an
 * error's serialized payload. Anything else that throws is a fault, answered
 * as `INTERNAL_ERROR` with the request id and reported server-side.
 */

import type { z } from 'zod';

import { type McpToolListing, toolListing } from '../../../lib/mcp/listing';
import { MCP_TOOLS, type McpToolSpec } from '../../../lib/mcp/tools';
import { defineAbilityFor } from '../../../lib/permissions/ability';
import { reportError } from '../../error-reporting';
import { codedAppError } from '../../lib/app-error-response';
import { rateLimitExceededCause } from '../../lib/rate-limit-response';
import { runInRequestChannel } from '../../lib/request-channel';
import { houseIssueMessage } from '../../rest/shared';
import type { McpCallOutcome } from './activity';
import type { McpCaller } from './caller';

/** The whole inventory, in the advertised order. */
export function listTools(): McpToolListing[] {
  return MCP_TOOLS.map(toolListing);
}

// ------------------------------------------------------------ arguments

/** One problem with a call's arguments: where (a dotted path, `''` for the
 * arguments as a whole), what kind of problem, and the reason in the REST
 * door's words. */
export interface ArgumentIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** How many issues one refusal lists — enough to fix any real call in one
 * round trip, never a hostile call echoed back at length. */
const MAX_ARGUMENT_ISSUES = 50;

function byPath(a: ArgumentIssue, b: ArgumentIssue): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

/**
 * Every problem of a refused parse, one per field and per unknown key,
 * sorted by path. zod reports the unknown keys of an object as one issue;
 * each key is named as its own problem so the agent can fix what it named.
 * Never an argument's value.
 */
function argumentIssues(error: z.ZodError): ArgumentIssue[] {
  return error.issues
    .flatMap((issue): ArgumentIssue[] => {
      const path = issue.path.map(String);
      if (issue.code === 'unrecognized_keys') {
        return issue.keys.map((key) => ({
          path: [...path, key].join('.'),
          code: 'unrecognized_key',
          message:
            path.length === 0
              ? 'is not an argument this tool takes'
              : 'is not a field this object takes',
        }));
      }
      // A refinement may name its own stable code (`params.code`); every
      // other issue carries the validator's kind of problem.
      const own =
        issue.code === 'custom' && typeof issue.params?.code === 'string'
          ? issue.params.code
          : undefined;
      return [
        {
          path: path.join('.'),
          code: own ?? issue.code,
          message: issue.message,
        },
      ];
    })
    .sort(byPath)
    .slice(0, MAX_ARGUMENT_ISSUES);
}

/** The refusal of a call whose arguments miss the tool's schema. */
function invalidArguments(
  tool: McpToolSpec,
  issues: readonly ArgumentIssue[],
): Record<string, unknown> {
  const first = issues[0] ?? {
    path: '',
    code: 'invalid_type',
    message: 'do not match the tool schema',
  };
  const where = first.path === '' ? 'the arguments' : `"${first.path}"`;
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
  return {
    error: `invalid arguments for ${tool.name}: ${where} ${first.message}${more}`,
    code: 'INVALID_ARGUMENTS',
    hint: `tools/list has the input schema of ${tool.name}; fix every issue in data.issues and call again`,
    data: { issues },
  };
}

// ------------------------------------------------------------ refusals

/** A refusal as the agent reads it. */
interface Refusal {
  error: string;
  code: string;
  hint?: string;
  data?: Record<string, unknown>;
}

/** The shape of a stable refusal code. A database's SQLSTATE never has it;
 * a socket's `ECONNRESET` does, which is why a refusal also needs a 4xx
 * status or one of the refusing classes below. */
const REFUSAL_CODE = /^[A-Z][A-Z0-9_]*$/;

/** Error classes that refuse without an HTTP status of their own. */
const STATUSLESS_REFUSALS: ReadonlySet<string> = new Set([
  'ActorAuthError',
  'CapabilityAuthError',
]);

function plainData(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * A thrown refusal as data, or null when what was thrown is a fault. A
 * refusal keeps its code and its own sentence: a spent budget is
 * `RATE_LIMITED` with the wait; a coded `AppError` gives its `data.message`
 * (its `message` serializes the whole payload, which never reaches an
 * agent); a domain error (`AutomationError`, `ConfigurationError`,
 * `ActorAuthError`, …) gives its code, sentence, hint and data.
 */
function refusalFromThrown(error: unknown): Refusal | null {
  const limited = rateLimitExceededCause(error);
  if (limited !== null) {
    return {
      error: `this key holder's budget for the call is spent; retry in ${Math.max(1, Math.ceil(limited.retryAfter / 1000))} s`,
      code: 'RATE_LIMITED',
      hint: 'wait data.retryAfterMs, then call again',
      data: { retryAfterMs: limited.retryAfter },
    };
  }
  const coded = codedAppError(error);
  if (coded !== null) {
    return {
      error: coded.message,
      code: coded.code,
      ...(coded.data === undefined ? {} : { data: coded.data }),
    };
  }
  if (!(error instanceof Error)) return null;
  const code: unknown = Reflect.get(error, 'code');
  if (typeof code !== 'string' || !REFUSAL_CODE.test(code)) return null;
  const status: unknown = Reflect.get(error, 'status');
  const refuses =
    typeof status === 'number'
      ? status >= 400 && status < 500
      : STATUSLESS_REFUSALS.has(error.name);
  if (!refuses) return null;
  const hint: unknown = Reflect.get(error, 'hint');
  const data = plainData(Reflect.get(error, 'data'));
  return {
    error: error.message,
    code,
    ...(typeof hint === 'string' && hint !== '' ? { hint } : {}),
    ...(data === undefined ? {} : { data }),
  };
}

/** What an agent hears of a fault: that it happened and the request id to
 * quote — nothing of the error itself, which may name internals. */
function internalError(
  tool: McpToolSpec,
  requestId: string,
): Record<string, unknown> {
  return {
    error: `${tool.name} failed unexpectedly`,
    code: 'INTERNAL_ERROR',
    hint: 'try again later; if it keeps failing, give data.requestId to whoever runs this Tale',
    data: { requestId },
  };
}

// ------------------------------------------------------------ results

/** The tools that EXECUTE an automation: their answer's `status` is the run's
 * own outcome, so `error` / `invalid` there means the call did not do its job.
 * A READ of a run (`get_run`) that found a failed run succeeded. */
const RUN_TOOLS: ReadonlySet<string> = new Set([
  'run_automation',
  'run_deployed',
]);

/** `test_automation` answers `status: 'invalid'` when the document could
 * not even be tested — the call did not do its job; a report with failing
 * tests is the verdict it was asked for, and an outcome. */
const TEST_TOOL = 'test_automation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a tool's answer says the call did not do its job — the shapes the
 * two surfaces use for that, per tool: the engine's refusal envelope is a
 * top-level string `error` (a run view's failure detail is an object, so a
 * read that succeeded is not mistaken for one); a capability answers
 * `refused` (an unknown id, arguments its schema rejects, a backend that
 * would not act) or `unavailable` (a knowledge base it could not search);
 * a run tool's `status` is the run's own, so `error` / `invalid` there is the
 * call failing at what it was asked to do. */
function isFailureShaped(tool: McpToolSpec, result: unknown): boolean {
  if (!isRecord(result)) return false;
  if (typeof result.error === 'string') return true;
  if (tool.kind === 'capability') {
    return result.status === 'refused' || result.status === 'unavailable';
  }
  if (RUN_TOOLS.has(tool.name)) {
    return result.status === 'error' || result.status === 'invalid';
  }
  if (tool.name === TEST_TOOL) return result.status === 'invalid';
  return false;
}

/** One answered tool call: the MCP `CallToolResult`, and how it went for the
 * call record. */
export interface ToolAnswer {
  readonly result: {
    readonly content: ReadonlyArray<{ type: 'text'; text: string }>;
    readonly structuredContent?: Record<string, unknown>;
    readonly isError: boolean;
  };
  readonly outcome: McpCallOutcome;
  readonly code?: string;
}

/**
 * Off the production path, say so loudly when a read tool's answer misses
 * the schema it advertises: a client that validates (the MCP SDKs do)
 * would refuse the call. Production never pays for the check.
 */
function checkAgainstSchema(tool: McpToolSpec, value: unknown): void {
  if (tool.result === null || process.env.NODE_ENV === 'production') return;
  const checked = tool.result.safeParse(value);
  if (!checked.success) {
    console.error(
      `[mcp] ${tool.name} answered outside its outputSchema:`,
      checked.error.issues.map((issue) => issue.path.join('.')),
    );
  }
}

/**
 * The answer as the agent reads it: the JSON as one compact text block
 * (pretty-printing cost about a quarter more tokens for the same facts),
 * plus — for a read tool whose call did its job — the same object as
 * `structuredContent`, which the tool's `outputSchema` describes. A refusal
 * carries text only.
 */
function answer(
  tool: McpToolSpec,
  value: unknown,
  outcome?: McpCallOutcome,
): ToolAnswer {
  const isError = outcome === 'error' || isFailureShaped(tool, value);
  const code =
    isRecord(value) && typeof value.code === 'string' ? value.code : undefined;
  const structured = !isError && tool.result !== null && isRecord(value);
  if (structured) checkAgainstSchema(tool, value);
  return {
    result: {
      content: [{ type: 'text', text: JSON.stringify(value) }],
      ...(structured ? { structuredContent: value } : {}),
      isError,
    },
    outcome: outcome ?? (isError ? 'refused' : 'ok'),
    ...(isError && code !== undefined ? { code } : {}),
  };
}

// ------------------------------------------------------------ the call

/** The surfaces a tool call reaches, each acting as the caller. The door
 * binds them to the database (`engine-host.ts`). */
export interface McpHost {
  /** One method of the automation engine's dispatch table. */
  readonly engine: (
    caller: McpCaller,
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  /** One of the platform's own tools (`platform-tools.ts`). */
  readonly platform: (
    caller: McpCaller,
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  /** One method of the organization's capability surface. */
  readonly capability: (
    caller: McpCaller,
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}

/** Null when the caller's role may use a `developer` tool; otherwise the
 * reason, from the same ability the in-app mutations check. The door
 * refuses a disabled member before this layer runs; the check stays so a
 * caller built any other way is never mistaken for a developer. */
function developerRefusal(caller: McpCaller): string | null {
  if (caller.role === 'disabled') {
    return `Not a member of organization "${caller.orgSlug}".`;
  }
  if (defineAbilityFor(caller.role).cannot('read', 'developerSettings')) {
    return `Role "${caller.role}" lacks the developer-settings capability required to perform this action.`;
  }
  return null;
}

/** Whether this call takes the developer bar: always for a `developer`
 * tool; for a `live-developer` one, when the call is live (`mode` absent or
 * `"live"`). */
function needsDeveloper(
  tool: McpToolSpec,
  args: Record<string, unknown>,
): boolean {
  if (tool.role === 'developer') return true;
  return tool.role === 'live-developer' && args.mode !== 'mock';
}

export interface ToolCallContext {
  readonly host: McpHost;
  /** The HTTP request the call arrived in. */
  readonly requestId: string;
  /** Asked before the call runs when the request already spent its first
   * call (a batch); a wait refuses this call at the protocol level. */
  readonly admit?: () => Promise<{ retryAfterMs: number } | null>;
  /** Draws one execution from the caller's budget for an `execute` tool,
   * after its role check; a wait refuses the call as `RATE_LIMITED`. */
  readonly charge?: (
    lane: 'rest:execute',
  ) => Promise<{ retryAfterMs: number } | null>;
}

/** The refusal of a call whose execution budget is spent. */
function rateLimited(
  tool: McpToolSpec,
  retryAfterMs: number,
): Record<string, unknown> {
  return {
    error: `${tool.name} is refused for now: this key holder has started as many executions as a minute allows; retry in ${Math.max(1, Math.ceil(retryAfterMs / 1000))} s`,
    code: 'RATE_LIMITED',
    hint: 'wait data.retryAfterMs before calling it again; reads, validation and saving do not draw from this budget',
    data: { retryAfterMs },
  };
}

/** What the protocol layer answers a `tools/call` with: a tool result, or —
 * for a batch call the request budget refused — a protocol error. */
export type ToolCallReply =
  | { readonly kind: 'answer'; readonly answer: ToolAnswer }
  | { readonly kind: 'admission'; readonly retryAfterMs: number };

/** Run one call of a tool the inventory holds. */
export async function callTool(
  caller: McpCaller,
  tool: McpToolSpec,
  rawArgs: unknown,
  context: ToolCallContext,
): Promise<ToolCallReply> {
  const parsed = tool.args.safeParse(rawArgs ?? {}, {
    reportInput: true,
    error: houseIssueMessage,
  });
  if (!parsed.success) {
    return {
      kind: 'answer',
      answer: answer(
        tool,
        invalidArguments(tool, argumentIssues(parsed.error)),
      ),
    };
  }
  if (context.admit !== undefined) {
    const wait = await context.admit();
    if (wait !== null) {
      return { kind: 'admission', retryAfterMs: wait.retryAfterMs };
    }
  }
  if (needsDeveloper(tool, parsed.data)) {
    const refusal = developerRefusal(caller);
    if (refusal !== null) {
      // The same role refusal the store raises on the live and run tools
      // (`ActorAuthError`), under the same code.
      return {
        kind: 'answer',
        answer: answer(tool, {
          error: `${tool.name} is refused for this key: ${refusal}`,
          code: 'FORBIDDEN_DEVELOPER_SETTINGS',
          hint: 'saving, deploying, deleting, installing, binding or removing a trigger and starting or stopping a live run need a key whose holder has the owner, admin or developer role; reading, validating, tests and mock runs (start_run with mode "mock") stay open to every member',
        }),
      };
    }
  }
  if (tool.lane === 'execute' && context.charge !== undefined) {
    const wait = await context.charge('rest:execute');
    if (wait !== null) {
      return {
        kind: 'answer',
        answer: answer(tool, rateLimited(tool, wait.retryAfterMs)),
      };
    }
  }
  const args: Record<string, unknown> = parsed.data;
  const { apiKeyId } = caller.credential;
  const { clientName } = caller;
  try {
    // Every audit row the call writes, however deep in a domain, names the
    // door, the tool, the key and the client (`request-channel.ts`).
    const value: unknown = await runInRequestChannel(
      {
        via: 'mcp',
        requestId: context.requestId,
        tool: tool.name,
        ...(apiKeyId === undefined ? {} : { apiKeyId }),
        ...(clientName === undefined ? {} : { clientName }),
      },
      () => context.host[tool.kind](caller, tool.name, args),
    );
    return { kind: 'answer', answer: answer(tool, value) };
  } catch (error) {
    const refusal = refusalFromThrown(error);
    if (refusal !== null) {
      return { kind: 'answer', answer: answer(tool, refusal) };
    }
    console.error(
      `[mcp] ${tool.name} failed (request ${context.requestId}):`,
      error,
    );
    reportError(error, {
      tags: { 'mcp.tool': tool.name },
      extra: { requestId: context.requestId },
    });
    return {
      kind: 'answer',
      answer: answer(tool, internalError(tool, context.requestId), 'error'),
    };
  }
}
