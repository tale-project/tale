// The harness exec-glue contract: what the platform asks of a sandbox
// harness (`HarnessRunSpec`), what the sandbox session-exec API runs
// (`HarnessExec`), and the one normalized event union every harness's native
// stdout stream maps into (`HarnessEvent`).
//
// The harness layer is CONFIG-FIRST: everything declarative — credential
// policy, credential env keys, model-id dialect, prompt transport,
// capabilities, pinned CLI version, AND the full exec construction facts —
// lives in `configs/platform/system/harnesses/<slug>.yml` and validates
// through `harnessConnectorSchema`. One generic interpreter
// (`exec-builder.ts`) turns those facts plus a `HarnessRunSpec` into a
// `HarnessExec`; the YAML's `parser` field keys the stream-parser family
// (`parsers/`), the one genuinely stateful part that stays code. The
// registry composes the two into a `HarnessGlue` per slug — there are no
// per-slug code modules.
//
// Changed from the retired v1 adapter contract (`lib/agent-adapters`):
//
//  - No deadline or timeout fields. Per-agent execution timeouts are removed
//    by design — the platform is a duration-independent I/O conduit. Lifecycle
//    mechanics (stdin idle grace, drain EOF, orphan GC) live in the runner,
//    never in this spec.
//  - `model` is caller-supplied and already resolved. The execution-resolution
//    case split picks the model and translates it into the dialect the harness
//    credential speaks (the YAML's `modelIdDialect`); the glue passes it
//    through verbatim.
//  - Credentials arrive resolved as one `credential` case: managed carries the
//    platform-gateway coordinates, byo carries the env map the caller built
//    from the resolved credential (keyed within the YAML's
//    `credentialEnvKeys`). The v1 `authMode` + optional-`gateway` pair and the
//    session-level credential injection are gone.
//  - Model fallback chains are retired: no `fallbackModel`, no Claude Code
//    `--fallback-model`, no OpenClaw `fallbacks` list. The turn runs entirely
//    on the selected model.
//  - No `maxTurns` knob. Where a CLI has a real turn cap it is pinned to the
//    fixed runaway backstop (`DEFAULT_MAX_TURNS`), not caller-tunable.
//  - MCP mounting is explicit (`mcp`): absent means no servers, replacing the
//    v1 default-on `browserMcp` flag. The `nativeWebTools` opt-in is dropped —
//    managed runs always deny the CLI's native web tools and route web access
//    through the platform capability surface; byo keeps the native toolset.
//  - `interactionMode` is dropped — no adapter ever consumed it.

/**
 * The nine shipped harnesses. One fact file per slug
 * (`configs/platform/system/harnesses/<slug>.yml`) carries the complete
 * declarative surface; the registry composes each into a `HarnessGlue`.
 */
export const HARNESS_SLUGS = [
  'claude-code',
  'codex',
  'cursor',
  'gemini',
  'hermes',
  'openclaw',
  'opencode',
  'pi',
  'qwen-code',
] as const;
export type HarnessSlug = (typeof HARNESS_SLUGS)[number];

/** Narrow an arbitrary string to a harness slug. */
export function isHarnessSlug(value: unknown): value is HarnessSlug {
  return (
    typeof value === 'string' &&
    (HARNESS_SLUGS as readonly string[]).includes(value)
  );
}

/**
 * The resolved credential a turn runs with — exactly one of the two cases the
 * harness YAML `credentialPolicy` can accept:
 *
 *  - `managed`: the platform LLM gateway with a session-scoped virtual key.
 *    The glue wires the harness-specific route (`/anthropic`, `/openai/v1`,
 *    `/genai`) onto `baseUrl` and places the key where the CLI reads it.
 *  - `byo`: the user's own provider credentials, built by the caller as an
 *    env map (the variables the harness reads them from — the YAML's
 *    `credentialEnvKeys`). The glue merges the map into the exec env verbatim.
 */
export type HarnessCredential =
  | {
      readonly mode: 'managed';
      readonly gateway: {
        /** Gateway root, no trailing slash, e.g. http://sandbox-llm-gateway:8080 */
        readonly baseUrl: string;
        /** Session virtual key minted at session create. */
        readonly token: string;
      };
    }
  | {
      readonly mode: 'byo';
      readonly env: Readonly<Record<string, string>>;
    };

/**
 * MCP servers to mount into the turn. Absent = mount nothing. Delivery is
 * harness-specific (argv config, staged file, env-injected config) and owned
 * by each glue module; harnesses whose YAML declares `capabilities.mcp: false`
 * ignore this entirely.
 */
export interface HarnessMcpConfig {
  /**
   * In-container Playwright browser server. `headless` self-launches a
   * headless Chromium; `cdp` attaches to the session's externally-launched
   * HEADED Chromium (live browser view — requires the session to have started
   * its browser stack; the two must agree).
   */
  readonly browser?: 'headless' | 'cdp';
  /**
   * Platform base URL of the capability-dispatch bridge. When set on a
   * managed run, the glue mounts the in-image `tale-integrations-mcp` server,
   * authenticated with the session key — credentials stay server-side; the
   * bridge only relays dispatch requests. Managed-only: byo runs carry no
   * session key, so the bridge is not mounted.
   */
  readonly bridgeUrl?: string;
}

/** What the platform asks a harness to run — one turn in a sandbox session. */
export interface HarnessRunSpec {
  /** The turn prompt (already composed by the platform). */
  readonly prompt: string;
  /**
   * Caller-resolved model ref, already in the dialect this harness's
   * credential speaks (managed = the gateway model id; byo = the YAML
   * `modelIdDialect` translation). Absent lets the CLI's own default apply.
   */
  readonly model?: string;
  /** The resolved credential case (see {@link HarnessCredential}). */
  readonly credential: HarnessCredential;
  /** Working directory inside the session (e.g. /user/workspace). */
  readonly workdir: string;
  /**
   * Absolute directories OUTSIDE `workdir` the harness must be able to reach
   * (e.g. the chat-upload staging dir /user/uploads). Only harnesses whose
   * file tools are cwd-scoped need per-dir grants; the rest ignore this.
   */
  readonly additionalDirs?: readonly string[];
  /**
   * Resume handle captured from a prior turn's `turn-started`/`turn-ended`
   * events. Continues the same harness conversation in the same workspace.
   */
  readonly resume?: string;
  /**
   * Turn posture. `plan` = read-only exploration that ends with a proposed
   * plan; `act` (default / absent) = full access. Only Claude Code has the
   * concept (its YAML declares `capabilities.planMode`); the rest ignore it.
   */
  readonly posture?: 'plan' | 'act';
  /**
   * System-prompt addendum composed by the platform (org instructions, trust
   * rules, skills guidance). Every harness delivers it through its own
   * append-not-replace channel; never dropped.
   */
  readonly instructions?: string;
  /** MCP servers to mount (see {@link HarnessMcpConfig}). */
  readonly mcp?: HarnessMcpConfig;
  /**
   * Managed only: arm the in-image vision polyfill for a text-only model.
   * `model` is the gateway model id the `tale-vision-read-hook` transcribes
   * images with. Only Claude Code wires it; the rest ignore it.
   */
  readonly vision?: { readonly model: string };
  /**
   * Platform exec id of this turn. Harnesses that support mid-turn steering
   * key their per-exec queue dir on it, and per-exec staged files use it so
   * concurrent turns sharing a workspace never read each other's inputs.
   */
  readonly execId?: string;
  /**
   * A subscription-key credential (coding-plan secret) for harnesses whose
   * YAML declares a `subscription` delivery: the interpreter injects
   * `secret` under the declared env var or stages it as the declared file,
   * and `baseUrl` (when the delivery names a base-URL var) points the CLI at
   * the subscription endpoint. Declarative wiring only for now — the
   * runtime consumer arrives with the chat rebuild.
   */
  readonly subscription?: {
    readonly secret: string;
    readonly baseUrl?: string;
  };
}

/**
 * The generic exec request the sandbox session-exec API accepts. The prompt
 * rides stdin wherever the CLI has a stdin prompt channel — process lists
 * leak argv — with Cursor and OpenCode as the documented argv exceptions.
 */
export interface HarnessExec {
  readonly argv: string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly stdin?: string;
  /**
   * `hold` keeps the process stdin open so the platform can push further
   * NDJSON lines mid-run (Claude Code stream-json steering); the runner
   * closes it (EOF) once the turn's terminal event arrived and no background
   * tasks or queued messages remain. Default `close`.
   */
  readonly stdinMode?: 'close' | 'hold';
  /**
   * Files the exec depends on, written into the session (`path` relative to
   * the /user mount) BEFORE the process is spawned — for inputs the CLI has
   * no flag for (e.g. OpenCode's instructions file). The runner MUST fail the
   * turn when staging fails: a silently missing file would silently drop the
   * input.
   */
  readonly stagedFiles?: Array<{ path: string; content: string }>;
}

export type HarnessTurnStatus =
  | 'completed'
  | 'error'
  | 'max-turns'
  | 'cancelled';

export interface HarnessUsage {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Client-side estimate only; informational, never the billing source of
   * truth — the gateway meters authoritatively. */
  costEstimateUsd?: number;
}

/**
 * The normalized event union every harness's native stdout maps into, so
 * entry points render progress and meter usage identically regardless of
 * which harness ran. Grouped: turn lifecycle (`turn-started`/`turn-ended`),
 * message parts (`text-delta`/`text`), tool activity
 * (`tool-use`/`tool-result`), accounting (`usage`), errors, steering,
 * background tasks, and the verbatim `raw` passthrough.
 *
 * `parentToolUseId`, where present, marks an event that streamed from a
 * sub-agent (it holds the parent task's `toolUseId`); absent for the main
 * agent. It lets the timeline nest sub-agent activity and lets the drain
 * treat it as non-main activity for quiet-idle detection.
 */
export type HarnessEvent =
  | {
      type: 'turn-started';
      harness: HarnessSlug;
      sessionId?: string;
      model?: string;
    }
  /** A streaming assistant text delta. */
  | { type: 'text-delta'; text: string; parentToolUseId?: string }
  /** A completed assistant text block (as opposed to streaming deltas). */
  | { type: 'text'; text: string; parentToolUseId?: string }
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
      parentToolUseId?: string;
    }
  | ({ type: 'usage'; parentToolUseId?: string } & HarnessUsage)
  | {
      type: 'turn-ended';
      status: HarnessTurnStatus;
      sessionId?: string;
      finalText?: string;
      durationMs?: number;
      usageTotals?: Pick<
        HarnessUsage,
        'inputTokens' | 'outputTokens' | 'costEstimateUsd'
      >;
      /** The harness reported a turn-terminating API error. `status` may
       * still read `completed` (Claude Code leaves `subtype:'success'` on an
       * errored result) — classify on this, not `status`. */
      isError?: boolean;
      /** Numeric HTTP status from the API error (e.g. 429/401), when the CLI
       * surfaces one. Absent for mid-stream failures. Lets a caller decide
       * whether to rotate credentials / retry. */
      apiErrorStatus?: number;
    }
  | { type: 'error'; message: string; raw?: unknown }
  /** A queued user message was injected into the RUNNING turn by the
   * in-sandbox steer hook. Only the Stop-hook delivery path surfaces in the
   * output stream — the platform's terminal reconciliation stays
   * authoritative; this event just flips the UI pill early when it appears. */
  | { type: 'steer-injected'; messageIds: string[]; text: string }
  /** A background task the harness launched started/settled. The platform
   * balances these as a ledger: a turn whose `turn-ended` arrived but whose
   * ledger is non-empty is LINGERING — the process stays alive and the runner
   * must not close the held-open stdin yet. `task-settled` covers completed
   * AND stopped/abandoned. */
  | { type: 'task-started'; taskId: string; description?: string }
  | { type: 'task-settled'; taskId: string; status?: string }
  /** Forward-compat: an unmapped native event, passed through verbatim so a
   * new harness-side event type is never silently dropped. */
  | { type: 'raw'; harness: HarnessSlug; payload: unknown };

/** Incremental stream parser. Feed decoded stdout chunks (any size, including
 * mid-line splits); `feed` returns the events newly completed by that chunk,
 * `end` flushes any final buffered line. */
export interface HarnessEventParser {
  feed(chunk: string): HarnessEvent[];
  end(): HarnessEvent[];
}

/** The per-harness glue surface. Composed by the registry from the YAML
 * facts: `buildExec` is the generic interpreter bound to the harness's
 * declarative exec facts, `createParser` the slug-bound parser family. */
export interface HarnessGlue {
  readonly slug: HarnessSlug;
  buildExec(spec: HarnessRunSpec): HarnessExec;
  createParser(): HarnessEventParser;
}

// Fixed per-turn tool-iteration backstop passed to CLIs that support a cap.
// This is a runaway-loop backstop, NOT a work budget: real autonomous tasks —
// browser automation (every click/snapshot/retry is a turn), multi-service
// bring-ups, long debugging sessions — routinely need hundreds of iterations,
// and hitting the cap ends the turn mid-task (looks like a silent freeze). A
// high ceiling keeps the platform a duration-independent I/O conduit (it
// never proactively kills a healthy agent) while still bounding a true
// infinite loop.
export const DEFAULT_MAX_TURNS = 200;
