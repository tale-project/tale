// Adapter input/output contract shared by every agent.

import type { AgentEventParser, ProductAgentSlug } from './events';

/** The platform LLM gateway endpoint + the session-scoped key. The
 * adapter appends its own protocol route (Claude → /anthropic, Cursor uses
 * /openai/v1) so callers pass one base. */
export interface GatewayTarget {
  /** Gateway root, no trailing slash, e.g. http://sandbox-llm-gateway:8080 */
  baseUrl: string;
  /** Session virtual key minted at session create. */
  token: string;
}

export interface AgentRunSpec {
  prompt: string;
  /** Gateway model id (e.g. an org-allowlisted model). */
  model?: string;
  /** Managed only: gateway model id of the model-level fallback (the catalog
   * entry's `fallbackModelId`, e.g. Opus 4.8 behind the Fable default). The
   * session VK is scoped to allow it alongside `model`. Adapters wire it as
   * BOTH fallback flavours Claude Code knows: the availability chain
   * (`--fallback-model`, overload/unavailable) and the content-based Fable
   * classifier fallback (the `ANTHROPIC_DEFAULT_OPUS_MODEL` slot). */
  fallbackModel?: string;
  /** Resume handle captured from a prior run's `run-started`/`result`
   * (Claude session_id / Cursor chat id). Continues the same agent
   * conversation in the same workspace. */
  agentSessionId?: string;
  /** Agent loop cap; defaults to 40 (matches the platform agent maxSteps). */
  maxTurns?: number;
  /** Turn permission posture. `plan` = read-only exploration that ends with a
   * proposed plan (Claude Code `--permission-mode plan`); `execute` (default)
   * = the existing full-access behavior. Adapters without the concept ignore
   * it. Fixed for the whole turn — continuations re-attach to the same exec. */
  permissionMode?: 'plan' | 'execute';
  /** Turn interaction posture. `autonomous` = no human in the loop (adapters may
   * gate off interactive-only affordances). `interactive` (default / absent)
   * keeps them. Independent of permissionMode. Adapters without the concept
   * ignore it. */
  interactionMode?: 'interactive' | 'autonomous';
  /** Extra system-prompt text appended to the agent's defaults. */
  systemPromptAppend?: string;
  /**
   * Credential mode. 'managed' (default / absent): route through the platform
   * gateway with the minted virtual key. 'byo': no gateway — the agent uses the
   * credentials the user injected into the session env, with a raw model
   * passthrough and native web tools enabled.
   */
  authMode?: 'managed' | 'byo';
  /** Managed only: opt in to the runtime's NATIVE web tools (Claude Code
   * WebSearch/WebFetch). Managed runs force-disable these by default and route
   * web access through a connected integration (governed: audit + metering +
   * untrusted-source wrapping); `true` lifts that denial. Absent/false keeps the
   * deny. BYO already runs with native web tools, so this is ignored for byo. */
  nativeWebTools?: boolean;
  /** Platform LLM gateway. Present for managed runs; ABSENT for byo. */
  gateway?: GatewayTarget;
  /** Platform base URL for the integration-dispatch bridge (/api/integrations).
   * When set, buildExec adds an `integrations` MCP server the agent uses to
   * call the org's connected integrations (credentials resolved server-side). */
  integrationsBaseUrl?: string;
  /** Managed only: enable the vision polyfill so a TEXT-ONLY agent can read
   * images. Set by the platform when the run is managed AND the agent's own
   * model lacks the provider registry's `vision` tag. The claude-code adapter
   * then sets the `TALE_VISION_*` env that arms the `tale-vision-read-hook`
   * PreToolUse(Read) hook (baked into the image): it transcribes any image the
   * agent reads via `visionModel` with the session key — no provider key in the
   * container. Requires `gateway` + `visionModel`; ignored for byo. */
  visionTool?: boolean;
  /** The gateway model id the vision hook transcribes with (the provider's
   * `vision`-tagged model). Present iff `visionTool`; the session VK is scoped to
   * allow it. */
  visionModel?: string;
  /** Working directory inside the session (e.g. /user/workspace). */
  workdir: string;
  /** Absolute directories OUTSIDE `workdir` the agent must be able to read/edit
   * — e.g. the chat-upload staging dir /user/uploads. Claude Code scopes its
   * file tools to cwd by default (even under bypassPermissions), so each entry
   * is granted via `--add-dir`. Adapters without an equivalent ignore it. */
  additionalDirs?: string[];
  /** Enable the in-container Playwright MCP server. Default true for the
   * agent profile; entry points pass false for headless/no-browser tasks to
   * save the per-turn tool-definition token overhead. */
  browserMcp?: boolean;
  /** Live browser view (read-only mirror). When true, Playwright MCP ATTACHES
   * to the session's externally-launched HEADED Chromium over CDP
   * (--cdp-endpoint http://127.0.0.1:9222) instead of self-launching headless —
   * so the browser can be mirrored read-only (x11vnc). Requires the operator to
   * have launched the session with TALE_BROWSER_CDP=1 (the entrypoint's
   * start_browser_stack); the two MUST agree (deployment-level decision). Falsy
   * keeps the headless self-launch byte-identical to today. */
  browserCdp?: boolean;
  /** Platform exec id of this run. When set, adapters that support mid-turn
   * steering (Claude Code via tale-steer-hook) export a per-exec queue dir
   * (TALE_STEER_DIR=/user/.runtime/tale/steer/<execId>) the platform stages
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
  /** 'hold' keeps the process stdin open so the platform can push further
   * NDJSON lines mid-run (Claude Code --input-format stream-json steering);
   * the drain closes it (EOF) once the turn's result event arrives and no
   * background tasks or queued messages remain. Default 'close'. */
  stdinMode?: 'close' | 'hold';
}

export interface CredentialPolicy {
  /** Managed-mode credential source. BYO always injects env credentials.
   * Only meaningful when `supportsManaged` is true. */
  managedSource: 'gateway' | 'agent-env';
  /** Which model-id dialect the runtime's BYO backend speaks for a
   * catalog-shaped ref. 'vendor-native': the credential talks to the model
   * vendor's own API (Claude Code + ANTHROPIC_API_KEY) — request the catalog
   * entry's `nativeModelId` (`claude-sonnet-4-6`). 'catalog': the credential
   * talks to an OpenRouter-style aggregator that speaks the catalog's own
   * vendor-prefixed ids (Hermes + OPENROUTER_API_KEY) — request the catalog id
   * itself (`anthropic/claude-sonnet-4.6`); the vendor-native translation is
   * an id the aggregator rejects. */
  byoModelIdSource: 'vendor-native' | 'catalog';
  supportsByo: boolean;
  /** Whether the runtime can run in managed mode at all. False for runtimes
   * whose CLI cannot route through the platform LLM gateway — e.g. Cursor, whose
   * CLI authenticates with only `--api-key`/`CURSOR_API_KEY` and exposes no
   * OpenAI-compatible base-URL override — which are therefore BYO only. */
  supportsManaged: boolean;
}

/** Session-relative user-level dir under HOME (/user/.runtime/home) where Tale
 * stages org/integration/workflow/bound skills for sandbox runtimes. null =
 * runtime does not support filesystem skills (skip staging + skillsGuidance). */
export const CLAUDE_COMPAT_SKILLS_STAGE_DIR =
  '.runtime/home/.claude/skills' as const;

export interface AgentCapabilities {
  processLifecycle: 'stdin-hold' | 'one-shot';
  promptTransport: 'stdin-ndjson' | 'argv-positional';
  mcpDelivery: 'inline-argv' | 'inline-env' | 'staged-file';
  supportsPlanMode: boolean;
  supportsMidTurnSteering: boolean;
  supportsAttachmentDirs: boolean;
  supportsIntegrationsBridge: boolean;
  supportsVisionPolyfill: boolean;
  /** Where Tale stages user-level skills for this runtime (session-relative).
   * null = no filesystem skill support. */
  skillsStageDir: string | null;
}

export interface AgentAdapter {
  readonly slug: ProductAgentSlug;
  readonly credentialPolicy: CredentialPolicy;
  readonly capabilities: AgentCapabilities;
  /** Env vars this runtime uses for credentials (scrubbed on agent switch). */
  readonly credentialEnvKeys: readonly string[];
  buildExec(spec: AgentRunSpec): SessionExecSpec;
  createParser(): AgentEventParser;
}

// Per-turn tool-iteration cap passed to the CLI (`claude --max-turns`). This is
// a runaway-loop backstop, NOT a work budget: real autonomous tasks — browser
// automation (every click/snapshot/retry is a turn), multi-service bring-ups,
// long debugging sessions — routinely need well over the old value of 40, and
// hitting the cap ends the turn mid-task (looks like a silent freeze). A high
// ceiling keeps the platform a duration-independent I/O conduit (it never
// proactively kills a healthy agent) while still bounding a true infinite loop.
export const DEFAULT_MAX_TURNS = 200;
