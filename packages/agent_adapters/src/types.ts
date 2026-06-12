// Adapter input/output contract shared by every agent.

import type { AgentEventParser, AgentSlug } from './events';

/** The platform LLM gateway (Bifrost) endpoint + the session-scoped key. The
 * adapter appends its own protocol route (Claude → /anthropic, OpenCode →
 * /openai/v1) so callers pass one base. */
export interface GatewayTarget {
  /** Gateway root, no trailing slash, e.g. http://bifrost:8080 */
  baseUrl: string;
  /** Session virtual key minted at session create. */
  token: string;
}

export interface AgentRunSpec {
  prompt: string;
  /** Gateway model id (e.g. an org-allowlisted model). */
  model?: string;
  /** Resume handle captured from a prior run's `run-started`/`result`
   * (Claude session_id / OpenCode sessionID). Continues the same agent
   * conversation in the same workspace. */
  agentSessionId?: string;
  /** Agent loop cap; defaults to 40 (matches the platform agent maxSteps). */
  maxTurns?: number;
  /** Extra system-prompt text appended to the agent's defaults. */
  systemPromptAppend?: string;
  gateway: GatewayTarget;
  /** Working directory inside the session (e.g. /workspace/repo). */
  workdir: string;
  /** Enable the in-container Playwright MCP server. Default true for the
   * agent profile; entry points pass false for headless/no-browser tasks to
   * save the per-turn tool-definition token overhead. */
  browserMcp?: boolean;
  /** Platform exec id of this run. When set, adapters that support mid-turn
   * steering (Claude Code via tale-steer-hook) export a per-exec queue dir
   * (TALE_STEER_DIR=/workspace/.tale/steer/<execId>) the platform stages
   * queued user messages into; the in-image hook injects them at the next
   * tool-use / stop boundary. execId-keyed so concurrent turns from other
   * threads sharing the workspace never see each other's messages. */
  execId?: string;
}

/** The generic session-exec request the sandbox /v1/sessions/:id/exec API
 * accepts. The prompt is on stdin, never argv (process lists leak argv). */
export interface SessionExecSpec {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  stdin?: string;
}

export interface AgentAdapter {
  readonly slug: AgentSlug;
  buildExec(spec: AgentRunSpec): SessionExecSpec;
  createParser(): AgentEventParser;
}

export const DEFAULT_MAX_TURNS = 40;
