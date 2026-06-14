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
  /** `parentToolUseId`: set when this delta streamed from a sub-agent (parent
   * Task's `toolUseId`); absent for the main agent. Lets the drain treat
   * sub-agent streaming as non-main activity for quiet-idle detection. */
  | { type: 'text-delta'; text: string; parentToolUseId?: string }
  /** A completed assistant text block (as opposed to streaming deltas).
   * `parentToolUseId` is set when this block was emitted by a sub-agent (the
   * agent's own Task/Agent tool) rather than the main agent — it holds the
   * parent Task's `toolUseId`; absent for main-agent text. */
  | { type: 'text'; text: string; parentToolUseId?: string }
  /** `parentToolUseId`: set for a sub-agent's tool call (parent Task's
   * `toolUseId`); absent for the main agent. Lets the timeline nest sub-agent
   * activity under its Task card instead of flattening it. */
  | {
      type: 'tool-use';
      toolUseId: string;
      toolName: string;
      input: unknown;
      parentToolUseId?: string;
    }
  | {
      type: 'tool-result';
      toolUseId: string;
      output?: unknown;
      isError?: boolean;
      /** Set for a sub-agent's tool result (parent Task's `toolUseId`). */
      parentToolUseId?: string;
    }
  /** `parentToolUseId`: set when this usage block belongs to a sub-agent's
   * assistant message; absent for the main agent. */
  | ({ type: 'usage'; parentToolUseId?: string } & AgentUsage)
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
  /** A queued user message was injected into the RUNNING turn by the
   * in-sandbox steer hook (tale-steer-hook). Only the Stop-hook delivery path
   * surfaces in the output stream (PostToolUse additionalContext is invisible
   * to stdout) — the platform's terminal reconciliation stays authoritative;
   * this event just flips the UI pill early when it does appear. */
  | { type: 'steer-injected'; messageIds: string[]; text: string }
  /** A background task the agent launched (Claude Code Bash run_in_background,
   * background Workflow, …) started/settled. The platform balances these as a
   * ledger: a turn whose `result` arrived but whose ledger is non-empty is
   * LINGERING — the process stays alive, the model gets re-invoked when the
   * task settles — so the drain must not close the held-open stdin yet.
   * `task-settled` covers completed AND stopped/abandoned (the CLI emits a
   * `stopped` notification when it kills tasks at shutdown). */
  | { type: 'task-started'; taskId: string; description?: string }
  | { type: 'task-settled'; taskId: string; status?: string }
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
