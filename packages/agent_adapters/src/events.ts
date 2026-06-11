// Normalized agent event schema — the cross-agent, cross-entry contract.
//
// Every supported coding agent's native event stream maps into this one union
// so entry points (chat card, workflow node, session console) render progress
// and meter usage identically regardless of which agent ran. The mapping from
// each agent's native shape lives in that agent's parse.ts; the mapping table
// is documented in the implementation plan.

export type AgentSlug = 'claude-code' | 'opencode';

export type AgentResultStatus =
  | 'completed'
  | 'error'
  | 'max-turns'
  | 'cancelled';

export interface AgentUsage {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Client-side estimate only (both CLIs document it as such); informational,
   * never the billing source of truth — the gateway meters authoritatively. */
  costEstimateUsd?: number;
}

export type AgentEvent =
  | {
      type: 'run-started';
      agent: AgentSlug;
      agentSessionId?: string;
      model?: string;
    }
  | { type: 'text-delta'; text: string }
  /** A completed assistant text block (as opposed to streaming deltas). */
  | { type: 'text'; text: string }
  | { type: 'tool-use'; toolUseId: string; toolName: string; input: unknown }
  | {
      type: 'tool-result';
      toolUseId: string;
      output?: unknown;
      isError?: boolean;
    }
  | ({ type: 'usage' } & AgentUsage)
  | {
      type: 'result';
      status: AgentResultStatus;
      agentSessionId?: string;
      finalText?: string;
      durationMs?: number;
      usageTotals?: Pick<
        AgentUsage,
        'inputTokens' | 'outputTokens' | 'costEstimateUsd'
      >;
    }
  | { type: 'error'; message: string; raw?: unknown }
  /** Forward-compat: an unmapped native event, passed through verbatim so a
   * new agent-side event type is never silently dropped. */
  | { type: 'raw'; agent: AgentSlug; payload: unknown };

/** Incremental stream parser. Feed decoded stdout chunks (any size, including
 * mid-line splits); `feed` returns the events newly completed by that chunk,
 * `end` flushes any final buffered line. */
export interface AgentEventParser {
  feed(chunk: string): AgentEvent[];
  end(): AgentEvent[];
}
