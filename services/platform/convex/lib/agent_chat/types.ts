/**
 * Type definitions for Agent Chat configuration.
 *
 * These types support fully parameterized agent configuration,
 * enabling lib/ to be completely decoupled from agents/.
 */

import type {
  ResponseReasoningSeed,
  ResponseStyleAdvice,
} from '../../../lib/shared/response-tuning';
import type { AgentRoutingConfig } from '../../../lib/shared/schemas/agents';
import type { ToolName } from '../../agent_tools/tool_registry';
import type { AgentType } from '../context_management/constants';

/**
 * Serializable Agent configuration for creating agents.
 * All fields are JSON-serializable and can be passed through scheduler.
 */
export interface SerializableAgentConfig {
  /** Agent name identifier */
  name: string;
  /**
   * Root behavior. Omitted = 'chat'. When 'image-generation', startAgentChat
   * routes to the direct image-gen action; when 'external-agent', it routes to
   * the external-agent turn (sandbox session) — both instead of
   * runAgentGeneration.
   */
  primaryBehavior?: 'chat' | 'image-generation' | 'external-agent';
  /** External agent runtime for `primaryBehavior: 'external-agent'`. */
  agentKind?: 'claude-code' | 'cursor' | 'opencode';
  /**
   * Credential/auth mode for `primaryBehavior: 'external-agent'`. 'managed'
   * (default) routes through the platform gateway with a minted virtual key;
   * 'byo' bypasses the gateway and uses the user-injected sandbox credentials
   * with a raw model passthrough. The per-agent authMode is the sole control;
   * there is no separate org-level gate.
   */
  authMode?: 'managed' | 'byo';
  /**
   * For `primaryBehavior: 'external-agent'` only — opt into the runtime's native
   * web tools (Claude Code WebSearch/WebFetch). Managed runs force-disable these
   * by default; `true` lifts the denial. Absent/`false` keeps the governed
   * default; BYO is unaffected.
   */
  nativeWebTools?: boolean;
  /**
   * For managed `primaryBehavior: 'external-agent'` only — the vision model
   * backing the `vision_read` polyfill when the agent's own model is text-only.
   * Unset falls back to the provider registry's `vision`-tagged default.
   */
  visionModel?: string;
  /** System instructions for the agent (empty for image-generation agents with no style prefix) */
  instructions: string;
  /** List of Convex tool names to enable */
  convexToolNames?: ToolName[];
  /** Integration names bound as dedicated tools (resolved at runtime) */
  integrationBindings?: string[];
  /** Workflow root version IDs bound as dedicated tools (resolved at runtime) */
  workflowBindings?: string[];
  /** Explicit model override */
  model?: string;
  /** Explicit provider name (matches provider filename, e.g. 'openrouter') */
  provider?: string;
  /** Maximum number of steps for tool calls */
  maxSteps?: number;
  /** Output format (text or json) */
  outputFormat?: 'text' | 'json';
  /** Knowledge retrieval mode: tool (agent calls rag_search), context (auto-inject), both, or off */
  knowledgeMode?: 'off' | 'tool' | 'context' | 'both';
  /** Web search retrieval mode: tool (agent calls web), context (auto-inject), both, or off */
  webSearchMode?: 'off' | 'tool' | 'context' | 'both';
  /** Per-agent personalization injection mode: 'on' (default) or 'off' (strip user memory + customInstructions + propose_memory tool). Use 'off' for high-risk / regulated agents (GDPR Art 22 / EU AI Act). */
  personalizationMode?: 'on' | 'off';
  /** Whether to include team documents in knowledge scope (default true) */
  includeTeamKnowledge?: boolean;
  /** Whether to include org-wide documents in knowledge scope (default false) */
  includeOrgKnowledge?: boolean;
  /** Team ID the agent is assigned to (primary/legacy) */
  agentTeamId?: string;
  /** All team IDs the agent is scoped to (union of teamId + sharedWithTeamIds) */
  agentTeamIds?: string[];
  /** Pre-resolved completed file IDs from agent-specific knowledge files */
  knowledgeFileIds?: string[];
  /**
   * Hard off-switch for delegation tools (the orchestrator's
   * double-delegation guard). Delegates are derived from the org chart at
   * tool-build time, so only this flag reliably disables delegation for a
   * stripped sub-agent.
   */
  delegationDisabled?: boolean;
  /** External runtime binding (task runs dispatch to a tale-daemon). */
  runtime?: {
    adapterType: string;
    daemonId?: string;
    permissionMode: 'safe' | 'auto_edits' | 'full_auto';
    workspaceKey?: string;
  };
  /**
   * Hard allowlist of skill slugs the agent may use. Empty / omitted = no
   * skills available; the runtime emits no `expand_skill` tool and no
   * "Available Skills" section in that case. `buildSkillContext` intersects
   * this list with the org's actual skills at turn start — stale slugs are
   * silently dropped.
   */
  skillBindings?: string[];
  /** Whether to inject structured response markers into the system prompt (default false) */
  structuredResponsesEnabled?: boolean;
  /** Per-agent timeout in milliseconds */
  timeoutMs?: number;
  /** Per-agent output token reserve */
  outputReserve?: number;
  /** Ordered fallback model IDs (tried in sequence when primary fails) */
  fallbackModels?: string[];
  /**
   * Prose-level response shaping (style/verbosity) the Auto router advised for
   * this turn. Rendered into a short system-prompt suffix by
   * `tuningInstructionSuffix`. Set ONLY in Auto mode; a pinned agent's tone
   * comes from its own `instructions`.
   */
  responseStyle?: ResponseStyleAdvice;
  /**
   * Coarse reasoning seed (effort/creativity) the Auto router advised for this
   * turn. Fed to `buildReasoningOptions` as a PRIOR — blended into the
   * difficulty score, never a hard override; the online controller still
   * refines from observed usage. Set ONLY in Auto mode.
   */
  routeSeed?: ResponseReasoningSeed;
  /**
   * Advisory reply-language hint set by the Auto router for this turn (BCP-47
   * code or language name). Feeds ONLY the response-language directive's
   * fallback (rule 3) for ambiguous input — the directive's explicit-request
   * (rule 1) and message-language (rule 2) rules still take precedence.
   * Unset for pinned agents and ambiguous messages.
   */
  replyLocaleHint?: string;
  /**
   * Per-agent routing / cascade behaviour. Mirrors `agentRoutingSchema`.
   * Consumed by the model-tier router and the speculative cascade.
   */
  routing?: AgentRoutingConfig;
  /**
   * Monthly spend guardrail (mirrors `agentJsonSchema.budget`). Rides the
   * serializable config because the enforcement points (chat-turn mutation,
   * delegation sub-steps, run admission) cannot read agent JSON files.
   */
  budget?: {
    monthlyCents: number;
    warnPct?: number;
    pausePct?: number;
  };
  /** Max concurrent task runs (mirrors `agentJsonSchema.maxConcurrentTasks`). */
  maxConcurrentTasks?: number;
  /** Opt-in: run task runs as a durable sandbox step instead of the inline LLM
   *  loop (mirrors `agentJsonSchema.preferDurableStepForTasks`; mutually
   *  exclusive with `runtime`). Read at the run_on_task dispatch seam. */
  preferDurableStepForTasks?: boolean;
}

/**
 * Hook configuration using FunctionHandle strings.
 * FunctionHandle is serializable and can be passed through scheduler.
 */
export interface AgentHooksConfig {
  /** FunctionHandle for beforeContext hook (mutation) */
  beforeContext?: string;
  /** FunctionHandle for beforeGenerate hook (mutation) */
  beforeGenerate?: string;
  /** FunctionHandle for afterGenerate hook (mutation) */
  afterGenerate?: string;
}

/**
 * Complete runtime configuration for starting an agent chat.
 * All fields are serializable and can be passed through scheduler.
 */
export interface AgentRuntimeConfig {
  /** Agent type identifier */
  agentType: AgentType;
  /** Serializable agent configuration */
  agentConfig: SerializableAgentConfig;
  /** Model to use for response generation */
  model: string;
  /** Model provider name (e.g., 'openrouter'). Omit to search all providers. */
  provider?: string;
  /** Debug tag for logging */
  debugTag: string;
  /** Enable streaming response */
  enableStreaming: boolean;
  /** Optional hooks configuration (FunctionHandles) */
  hooks?: AgentHooksConfig;
}

/**
 * Optional LLM generation parameters (temperature, etc.).
 * Only set fields that are explicitly provided; omit to use model defaults.
 */
export interface GenerationParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
}

export interface RunAgentGenerationArgs {
  agentType: string;
  agentConfig: SerializableAgentConfig;
  model: string;
  provider?: string;
  debugTag: string;
  enableStreaming?: boolean;
  hooks?: AgentHooksConfig;
  threadId: string;
  organizationId: string;
  userId?: string;
  agentSlug?: string;
  promptMessage: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
  agentOptions?: unknown;
  attachments?: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }>;
  streamId?: string;
  promptMessageId?: string;
  maxSteps?: number;
  /** Optional per-request generation parameters from OpenAI compat endpoint */
  generationParams?: GenerationParams;
  /** Governance-enforced max context tokens (overrides agent config) */
  maxContextTokens?: number;
}

/**
 * Result from beforeContext hook.
 */
export interface BeforeContextHookResult {
  contextSummary?: string;
  [key: string]: unknown;
}

/**
 * Result from beforeGenerate hook.
 */
export interface BeforeGenerateHookResult {
  promptContent?: unknown;
  systemContextMessages?: unknown[];
  additionalContextData?: Record<string, unknown>;
}
