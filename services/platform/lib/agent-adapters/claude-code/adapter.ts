// Claude Code adapter — builds the headless `claude -p` exec + parses its
// stream-json output. The container is the safety boundary, so we run with
// bypassPermissions (permitted because the agent-profile user is non-root).

import type { AgentEventParser } from '../events';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunSpec,
  CredentialPolicy,
  SessionExecSpec,
} from '../types';
import { CLAUDE_COMPAT_SKILLS_STAGE_DIR } from '../types';
import { DEFAULT_MAX_TURNS } from '../types';
import { ClaudeCodeParser } from './parse';
import { buildStdinUserMessage } from './stdin';

/** In-container Playwright MCP launch (stdio). `--strict-mcp-config` isolates
 * the user repo's own .mcp.json so a run is reproducible regardless of repo
 * contents. tale-playwright-mcp is the image's launcher shim — it bridges the
 * container's HTTPS_PROXY/NO_PROXY into --proxy-server/--proxy-bypass
 * (Chromium ignores the env vars; the sandbox network is internal-only). */
const PLAYWRIGHT_MCP_SERVER = {
  command: 'tale-playwright-mcp',
  // --browser chromium: the image ships chromium, not the default Google
  //   Chrome channel.
  // --isolated: in-memory profile — the default persistent profile dir
  //   lives under PLAYWRIGHT_BROWSERS_PATH, read-only at runtime.
  // --no-sandbox: the session container (cap-drop=ALL, no-new-privileges)
  //   has no unprivileged userns, so Chromium's zygote sandbox aborts at
  //   launch; the container itself is the isolation boundary.
  // --ignore-https-errors: this browser exists to test the apps the agent
  //   builds, which routinely serve over localhost with a self-signed cert
  //   (e.g. Caddy's internal CA) or no TLS at all; without this, navigating
  //   to such a dev server fails closed with ERR_CERT_AUTHORITY_INVALID and
  //   there is no per-navigation override (it's a launch-time context
  //   option). The sandbox is isolated and egress-filtered, so this is not a
  //   general-purpose secure browser.
  args: [
    '--headless',
    '--browser',
    'chromium',
    '--isolated',
    '--no-sandbox',
    '--ignore-https-errors',
  ],
};

/** Live-browser-view args (browserCdp). Instead of self-launching a headless
 * Chromium, the MCP ATTACHES over CDP to the session's externally-managed
 * HEADED Chromium (entrypoint start_browser_stack, listening on loopback
 * 127.0.0.1:9222) so the browser can be mirrored read-only by x11vnc. The
 * self-launch flags (--headless/--browser/--isolated/--no-sandbox/
 * --ignore-https-errors) all belong to the now-externally-launched browser and
 * must be dropped — connectOverCDP ignores launch options. The shim
 * (tale-playwright-mcp) also skips the proxy flags in this mode; the managed
 * browser already carries the egress proxy. */
const PLAYWRIGHT_MCP_CDP_SERVER = {
  command: 'tale-playwright-mcp',
  args: ['--cdp-endpoint', 'http://127.0.0.1:9222'],
};

/** Model families whose context window Claude Code expands to 1M when the model
 * string carries a trailing `[1m]` marker. Haiku is 200K-only and is left
 * untouched (it would just ignore the marker). */
const CONTEXT_1M_FAMILIES = ['opus', 'sonnet', 'fable'] as const;

/** Default the in-sandbox agent to the maximum (1M) context window. Claude Code
 * gates its 1M window on a `[1m]` suffix on the model string, and strips that
 * suffix via its own normalizeModelStringForAPI BEFORE the request — so the
 * gateway / single-model virtual-key allowlist only ever sees the bare model id
 * (appending it cannot 404 the VK). 1M carries no long-context premium on
 * current Opus, so it is on by default; an operator can force the 200K default
 * back with TALE_SANDBOX_CONTEXT_1M=0, and a model string that already encodes a
 * window (`…[1m]`) is left as-is. (Reasoning depth is the separate
 * CLAUDE_CODE_EFFORT_LEVEL knob — set as an overridable env floor in the sandbox
 * image, NOT here: a per-exec env value would override the user's session env.) */
function withMaxContext(model: string): string {
  if (process.env.TALE_SANDBOX_CONTEXT_1M === '0') return model;
  const lower = model.toLowerCase();
  if (lower.includes('[1m]')) return model; // caller already chose a window
  if (!CONTEXT_1M_FAMILIES.some((family) => lower.includes(family))) {
    return model; // e.g. haiku — 200K only
  }
  return `${model}[1m]`;
}

/** Prepend Claude Code's `ultrathink` keyword to the turn prompt so every turn
 * requests maximum reasoning depth. On Opus-class (adaptive-thinking) models the
 * keyword is SAFE: Claude Code injects a "reason thoroughly" reminder for the
 * turn — it does NOT set a `budget_tokens` (which would 400 on Opus 4.8). This is
 * complementary to CLAUDE_CODE_EFFORT_LEVEL=max (the primary depth lever).
 * Default-on; disable with TALE_SANDBOX_ULTRATHINK=0, and skipped when the prompt
 * already contains the keyword. */
function withUltrathink(prompt: string): string {
  if (process.env.TALE_SANDBOX_ULTRATHINK === '0') return prompt;
  if (/\bultrathink\b/i.test(prompt)) return prompt; // caller already asked
  return `Ultrathink: ${prompt}`;
}

/** Baseline working rules every Claude Code session carries, independent of the
 * per-agent (org-editable, seeded) systemInstructions: git-attribution hygiene,
 * formatter-hook etiquette, the empty-catch ban, and honoring the working repo's
 * own AGENTS.md. Session-level like withUltrathink / withMaxContext — applied in
 * code, so it reaches every Claude Code run in every org and an org admin cannot
 * drop it by editing their agent config. */
const CLAUDE_CODE_HOUSE_RULES = [
  '## Notes',
  '',
  '- If the repository you are working in contains an AGENTS.md file, read it and follow its instructions.',
  "- Respect hooks that change formatting; don't hand-format or re-run a formatter.",
  '',
  '## Git',
  '',
  '- **Never** add `Co-Authored-By` to commit messages.',
  '- **Never** add "Generated with Claude Code" or any similar attribution to commits or PR descriptions.',
  '',
  '## Other',
  '',
  '- **Never** use an empty catch block — log (`console.warn`/`console.error`) or re-throw.',
].join('\n');

/** Prepend the baseline house rules to the composed system-prompt append so they
 * ride on every session ahead of the turn's posture/safety addenda (the composed
 * payload ends with the untrusted-content block, which stays last). Default-on;
 * idempotent (skipped when already present); disabled with
 * TALE_SANDBOX_HOUSE_RULES=0. Returns the rules alone when nothing was composed,
 * so they apply even to an agent with empty systemInstructions. */
function withHouseRules(systemPromptAppend: string | undefined): string {
  const base = systemPromptAppend ?? '';
  if (process.env.TALE_SANDBOX_HOUSE_RULES === '0') return base;
  if (base.includes(CLAUDE_CODE_HOUSE_RULES)) return base;
  return base
    ? `${CLAUDE_CODE_HOUSE_RULES}\n\n${base}`
    : CLAUDE_CODE_HOUSE_RULES;
}

const CREDENTIAL_POLICY: CredentialPolicy = {
  managedSource: 'gateway',
  supportsByo: true,
  supportsManaged: true,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'stdin-hold',
  promptTransport: 'stdin-ndjson',
  mcpDelivery: 'inline-argv',
  supportsPlanMode: true,
  supportsMidTurnSteering: true,
  supportsAttachmentDirs: true,
  supportsIntegrationsBridge: true,
  supportsVisionPolyfill: true,
  skillsStageDir: CLAUDE_COMPAT_SKILLS_STAGE_DIR,
};

const CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'TALE_GATEWAY_TOKEN',
] as const;

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly slug = 'claude-code' as const;
  readonly credentialPolicy = CREDENTIAL_POLICY;
  readonly capabilities = CAPABILITIES;
  readonly credentialEnvKeys = CREDENTIAL_ENV_KEYS;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    // BYO ("bring your own credentials") opts out of the platform gateway: no
    // virtual key, no gateway base URL, a raw model passthrough, and the
    // governance-motivated native-tool denials lifted. Managed (default) keeps
    // today's gateway + governance behavior.
    const byo = spec.authMode === 'byo';
    const argv = [
      'claude',
      '-p',
      '--output-format',
      'stream-json',
      // stdin is a held-open NDJSON channel (stdinMode:'hold'): the prompt is
      // the first user-message line; the platform pushes steer messages as
      // further lines while the process lingers on background tasks. In this
      // mode the CLI emits a per-turn `result` and keeps running until stdin
      // EOF (verified 2.1.173) — the drain sends EOF once the result is in
      // and no background tasks / queued messages remain.
      '--input-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      // plan: read-only exploration; the CLI denies writes and the turn ends
      // with the proposed plan (ExitPlanMode carries it in input.plan). The
      // platform gates execution — approval starts a fresh execute turn that
      // --resumes this session.
      spec.permissionMode === 'plan' ? 'plan' : 'bypassPermissions',
      '--max-turns',
      String(spec.maxTurns ?? DEFAULT_MAX_TURNS),
    ];
    // Grant read/edit access to directories OUTSIDE cwd (e.g. the chat-upload
    // staging dir /user/uploads). Claude Code's file tools are scoped to the
    // working dir even under bypassPermissions, so a staged attachment at an
    // absolute path outside /user/workspace is unreadable without this.
    for (const dir of spec.additionalDirs ?? []) {
      argv.push('--add-dir', dir);
    }
    if (spec.agentSessionId) argv.push('--resume', spec.agentSessionId);
    // Every session (managed AND BYO) defaults to the max 1M context window:
    // withMaxContext appends the `[1m]` marker, which Claude Code strips before
    // the API call, so the provider / gateway only ever sees the bare model id —
    // it does not change what a BYO user's own provider receives. (spec.model
    // is already the right id for the wire: the gateway model for managed; for
    // BYO the catalog entry's vendor-native id when it declares one —
    // run_external_agent resolves `nativeModelId` — else the raw user id.)
    if (spec.model) {
      argv.push('--model', withMaxContext(spec.model));
    }
    // Availability fallback (managed): when the primary model is overloaded or
    // unavailable (e.g. Fable under high load / usage pressure), Claude Code
    // retries the turn on this chain instead of failing it. The VK is scoped to
    // allow this model alongside the primary. BYO gets no platform fallback —
    // the agent's own model list is the user's explicit choice (no override),
    // and Claude Code's native ids already carry its built-in behavior.
    if (!byo && spec.fallbackModel) {
      argv.push('--fallback-model', spec.fallbackModel);
    }
    // Baseline house rules ride on every session (like withUltrathink /
    // withMaxContext), so they apply even when no per-agent systemPromptAppend
    // was composed.
    const systemPromptAppend = withHouseRules(spec.systemPromptAppend);
    if (systemPromptAppend) {
      argv.push('--append-system-prompt', systemPromptAppend);
    }
    // One merged --mcp-config (Playwright + the integration bridge), isolated
    // from the repo's own .mcp.json via --strict-mcp-config so a run is
    // reproducible regardless of repo contents.
    const mcpServers: Record<string, unknown> = {};
    if (spec.browserMcp !== false) {
      // browserCdp: attach to the session's externally-launched headed Chromium
      // over CDP (read-only mirror); otherwise self-launch headless as today.
      const browserServer =
        spec.browserCdp === true
          ? PLAYWRIGHT_MCP_CDP_SERVER
          : PLAYWRIGHT_MCP_SERVER;
      // Text-only agent (vision polyfill active): force the browser tools to
      // SAVE images (screenshots) to disk instead of returning them inline
      // (`--image-responses omit`). An inline image bypasses the Read hook and
      // 404s on the text-only model; a saved file is read via Read, where the
      // vision hook transcribes it. `browser_take_screenshot` still writes the
      // file and its text result names the path, so the agent reads it as usual.
      mcpServers.playwright = spec.visionTool
        ? {
            ...browserServer,
            args: [...browserServer.args, '--image-responses', 'omit'],
          }
        : browserServer;
    }
    if (spec.integrationsBaseUrl && spec.gateway) {
      // The integration-dispatch bridge — lets the agent use the org's connected
      // integrations. The credential stays server-side; the bridge only relays
      // {slug, operation, args} to the platform, authed by the session key.
      // The bridge is authed by the minted session key, so it is managed-only:
      // BYO runs carry no gateway/session key and therefore no bridge.
      mcpServers.integrations = {
        command: 'tale-integrations-mcp',
        env: {
          TALE_INTEGRATIONS_URL: spec.integrationsBaseUrl,
          TALE_INTEGRATIONS_TOKEN: spec.gateway.token,
        },
      };
    }
    if (Object.keys(mcpServers).length > 0) {
      argv.push(
        '--mcp-config',
        JSON.stringify({ mcpServers }),
        '--strict-mcp-config',
      );
    }
    // Collected deny list (a deny rule with a bare built-in name removes the
    // tool from the model's context entirely — verified against the permissions
    // docs).
    const disallowedTools: string[] = [];
    // AskUserQuestion (built-in): there is NO answer path in our chat surface —
    // the agent is a conversational worker, so it asks in prose (interactive,
    // the user replies in chat) or makes assumptions (autonomous). The built-in
    // structured-question tool would dead-end, so deny it in BOTH modes and for
    // BOTH managed and BYO — this is interaction-correctness, not governance, so
    // it is NOT lifted for BYO.
    disallowedTools.push('AskUserQuestion');
    // Deny the built-in WebSearch AND WebFetch. Both are model-coupled and
    // ungoverned: WebSearch is a provider-run search, and WebFetch pipes the
    // fetched page through a model to extract the answer — neither flows
    // through our integration audit / untrusted-source wrapping / metering, and
    // on a non-Anthropic gateway model they behave inconsistently. ALL web
    // access goes through a connected integration via the dispatch bridge:
    // search via a search integration's `search` op (e.g. Tavily) and reading a
    // specific page via its `extract`/fetch op — both audited and wrapped.
    // BYO opts out of platform governance, so this governance-motivated denial
    // is lifted — the agent runs with its native toolset (web tools work on the
    // user's own credential). The container + egress policy stay the isolation
    // boundary. A managed agent can also opt in explicitly (spec.nativeWebTools)
    // — e.g. on a gateway model that supports native web tools (OpenRouter) where
    // ungoverned web access is acceptable; then the deny is lifted for it too.
    if (!byo && spec.nativeWebTools !== true) {
      disallowedTools.push('WebSearch', 'WebFetch');
    }
    if (disallowedTools.length > 0) {
      argv.push('--disallowedTools', disallowedTools.join(','));
    }

    const env: Record<string, string> = {
      CLAUDE_CONFIG_DIR: '/user/.runtime/home/.claude',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
    if (!byo && spec.gateway) {
      // MANAGED: Anthropic Messages route on the platform gateway; the session
      // key is a bearer token (ANTHROPIC_AUTH_TOKEN takes precedence over
      // X-Api-Key). Blank the API key so it never conflicts with the bearer
      // (documented Claude Code gotcha → model-not-found otherwise).
      env.ANTHROPIC_BASE_URL = `${spec.gateway.baseUrl}/anthropic`;
      env.ANTHROPIC_AUTH_TOKEN = spec.gateway.token;
      env.ANTHROPIC_API_KEY = '';
    }
    if (spec.visionTool && spec.gateway && spec.visionModel) {
      // Vision polyfill (managed, text-only model): the `tale-vision-read-hook`
      // PreToolUse hook (registered globally in managed-settings.json) fires on
      // every Read but self-gates on TALE_VISION_MODEL — set here ONLY for a
      // text-only agent. When an image is Read, the hook transcribes it via the
      // gateway's vision model with the SESSION KEY (no provider key enters the
      // container; the VK is scoped to also allow visionModel) and denies the
      // native read, feeding the extracted TEXT back to the model — so an image
      // from ANY source (attachment, download, saved screenshot) never reaches
      // the text-only model. (Images returned INLINE by an MCP tool bypass hooks
      // and are not covered.) Env, not MCP: the hook subprocess inherits it.
      env.TALE_GATEWAY_URL = spec.gateway.baseUrl;
      env.TALE_GATEWAY_TOKEN = spec.gateway.token;
      env.TALE_VISION_MODEL = spec.visionModel;
    }
    // BYO: inject NO gateway / key / API-key-blanking env. The agent
    // authenticates with the user-injected session credentials
    // (CLAUDE_CODE_OAUTH_TOKEN or their own ANTHROPIC_API_KEY), per Claude
    // Code's own credential precedence, and talks directly to the provider.
    if (spec.execId) {
      // Mid-turn steering: the in-image tale-steer-hook (registered via
      // managed-settings PostToolUse/Stop hooks) reads this per-exec dir and
      // injects any platform-staged user messages at the next boundary.
      env.TALE_STEER_DIR = `/user/.runtime/tale/steer/${spec.execId}`;
    }
    if (spec.model) {
      // The CLI's own default, ahead of the per-tier aliases: internal paths
      // that resolve a model WITHOUT consulting --model fall back here — the
      // queued-message replay (a steer message landing in a turn's closing
      // moments is re-run as a new turn) otherwise uses the BUILT-IN default
      // (claude-sonnet-4-6), bypassing every alias pin. Observed live on
      // 2.1.173: the replayed turn requested sonnet through the gateway and
      // the org's open-models-only key 403'd the whole turn.
      env.ANTHROPIC_MODEL = withMaxContext(spec.model);
      if (!byo) {
        // MANAGED: pin every default-model slot to a gateway model so Claude
        // Code doesn't 404 resolving opus/sonnet/haiku/fable aliases against
        // the VK's allowlist. BYO has no such allowlist, so leave the alias +
        // subagent slots to the CLI / credential defaults.
        //
        // When the platform resolved a model-level fallback (the catalog
        // entry's fallbackModelId — Opus 4.8 behind the Fable default), the
        // NON-FABLE slots point at IT rather than the primary: Claude Code's
        // content-based Fable fallback re-runs a classifier-flagged request on
        // "the default Opus model" (the ANTHROPIC_DEFAULT_OPUS_MODEL slot), so
        // pointing that slot at the primary would fall back onto the very
        // model being rationed/flagged. The FABLE slot must stay the primary —
        // it is also how Claude Code IDENTIFIES the session model as Fable on
        // a gateway (the id may not contain `claude-fable-5`), which arms the
        // fallback in the first place.
        const aliasTarget = spec.fallbackModel ?? spec.model;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = aliasTarget;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = aliasTarget;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = aliasTarget;
        env.ANTHROPIC_DEFAULT_FABLE_MODEL = spec.model;
        // The session VK only allows the selected model (+ the fallback), so a
        // subagent whose frontmatter names a concrete model id would be
        // rejected at the gateway; this slot outranks frontmatter and pins
        // them all to the primary.
        env.CLAUDE_CODE_SUBAGENT_MODEL = spec.model;
      }
    }

    return {
      argv,
      env,
      cwd: spec.workdir,
      // Every session prepends the `Ultrathink:` keyword for max reasoning depth
      // (a safe per-turn reminder on Opus-class models; see the helper).
      stdin: buildStdinUserMessage(withUltrathink(spec.prompt)),
      stdinMode: 'hold',
    };
  }

  createParser(): AgentEventParser {
    return new ClaudeCodeParser();
  }
}
