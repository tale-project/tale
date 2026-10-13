/**
 * Whether the access a coding agent was given covers a call.
 *
 * An agent that signed in holds the scopes its person allowed when they
 * connected it (`lib/shared/agent-access.ts`); a tool names the scopes that
 * let it run (`lib/mcp/tools.ts`). A scope never widens a role — the person's
 * live role is checked first, as it is for a key — it only narrows what the
 * connection does with it. An API key holds no scopes, so a call made with
 * one is always covered here.
 *
 * Three answers. The call is covered. The connection lacks access its person
 * could allow by connecting the agent again: the request is refused whole
 * with a challenge naming what to ask for (`scopeShortfalls`), so a client
 * that knows how asks for it and the call is retried. Or no connection of
 * this person's role could hold the access: the call is refused as a tool
 * error, since asking again would change nothing.
 */

import {
  findMcpTool,
  requiredScopes,
  type McpToolSpec,
  type ToolScopes,
} from '../../../lib/mcp/tools';
import {
  type AgentScope,
  AGENT_SCOPES,
  describeAgentScope,
  OFFLINE_ACCESS,
  scopeCeilingForRole,
} from '../../../lib/shared/agent-access';
import { isRecord } from '../../../lib/utils/type-utils';
import type { McpCaller } from './caller';

export type ScopeVerdict =
  | { readonly kind: 'covered' }
  /** The person could allow it: `ask` is the scope to ask for. */
  | {
      readonly kind: 'ask';
      readonly ask: AgentScope;
      readonly needs: ToolScopes;
    }
  /** No connection of this role could hold it. */
  | { readonly kind: 'role'; readonly needs: ToolScopes };

const COVERED: ScopeVerdict = { kind: 'covered' };

/** Whether the connection behind `caller` covers a call of `tool` with
 * these arguments. */
export function scopeVerdict(
  caller: McpCaller,
  tool: McpToolSpec,
  args: unknown,
): ScopeVerdict {
  const { credential } = caller;
  if (credential.kind !== 'agent') return COVERED;
  const needs = requiredScopes(tool, args);
  if (needs.some((scope) => credential.scopes.has(scope))) return COVERED;
  const ceiling = scopeCeilingForRole(caller.role);
  const ask = needs.find((scope) => ceiling.includes(scope));
  return ask === undefined
    ? { kind: 'role', needs }
    : { kind: 'ask', ask, needs };
}

/** The sentence that names the access a call needs, in the consent page's
 * words: one scope, or the first of several that would do. */
function accessWords(verdict: Exclude<ScopeVerdict, { kind: 'covered' }>) {
  const scope = verdict.kind === 'ask' ? verdict.ask : verdict.needs[0];
  return `"${describeAgentScope(scope)}"`;
}

/** The refusal of one call, as a tool error the agent reads: it names the
 * access the call needs and whether reconnecting can give it. */
export function scopeRefusal(
  tool: McpToolSpec,
  verdict: Exclude<ScopeVerdict, { kind: 'covered' }>,
): Record<string, unknown> {
  const access = accessWords(verdict);
  return {
    error: `${tool.name} needs the ${access} access, which this connection does not hold`,
    code: 'INSUFFICIENT_SCOPE',
    hint:
      verdict.kind === 'ask'
        ? `ask the person to connect the agent again and allow ${access}; a connection holds only what its person allowed`
        : `a connection made by a person with this role cannot hold ${access}; tell the person instead of retrying`,
    data: { tool: tool.name, requiredScopes: [...verdict.needs] },
  };
}

/** One tool call of a request that needs access its connection lacks. */
export interface ScopeShortfall {
  readonly tool: string;
  readonly ask: AgentScope;
}

/**
 * The tool calls among a request's messages that the connection's access
 * does not cover and its person could allow — what makes the whole request
 * refused before any of it runs. A message that is not a `tools/call` that
 * would be answered (a notification never is), names a tool the inventory
 * does not hold, or whose role cannot hold the access is not counted: the
 * first gets its own error, the last is refused as a tool error
 * (`scopeRefusal`) when it is reached.
 */
export function scopeShortfalls(
  caller: McpCaller,
  messages: readonly unknown[],
): ScopeShortfall[] {
  if (caller.credential.kind !== 'agent') return [];
  const found = new Map<string, ScopeShortfall>();
  for (const message of messages) {
    if (
      !isRecord(message) ||
      message.method !== 'tools/call' ||
      message.id === undefined ||
      !isRecord(message.params) ||
      typeof message.params.name !== 'string'
    ) {
      continue;
    }
    const tool = findMcpTool(message.params.name);
    if (tool === undefined || found.has(tool.name)) continue;
    const verdict = scopeVerdict(caller, tool, message.params.arguments);
    if (verdict.kind === 'ask') {
      found.set(tool.name, { tool: tool.name, ask: verdict.ask });
    }
  }
  return [...found.values()];
}

/** What a request refused for want of access says: the body, and the
 * scopes the agent should ask for — everything it holds, so that asking
 * never drops access it already had, and what it lacks. */
export function insufficientScope(
  caller: McpCaller,
  shortfalls: readonly ScopeShortfall[],
): {
  body: Record<string, unknown>;
  scope: string[];
  description: string;
} {
  const held =
    caller.credential.kind === 'agent' ? [...caller.credential.scopes] : [];
  const asks = [...new Set(shortfalls.map((entry) => entry.ask))];
  const scope = [
    ...AGENT_SCOPES.filter(
      (candidate) => held.includes(candidate) || asks.includes(candidate),
    ),
    ...(held.includes(OFFLINE_ACCESS) ? [OFFLINE_ACCESS] : []),
  ];
  const named = shortfalls.map(
    (entry) => `${entry.tool} ("${describeAgentScope(entry.ask)}")`,
  );
  // A challenge's description is a quoted string: it carries no quote.
  const only = shortfalls[0];
  const description =
    shortfalls.length === 1 && only !== undefined
      ? `${only.tool} needs the ${describeAgentScope(only.ask)} access, which this connection does not hold`
      : `${shortfalls.length} tools in this request need access this connection does not hold`;
  return {
    description,
    scope,
    body: {
      error: `${shortfalls.length === 1 ? `${named.join('')} needs` : `${named.join(', ')} need`} access this connection does not hold. Connect the agent again and allow it.`,
      code: 'INSUFFICIENT_SCOPE',
      data: {
        tools: shortfalls.map((entry) => entry.tool),
        requiredScopes: asks,
        grantedScopes: [...held].sort(),
      },
    },
  };
}
