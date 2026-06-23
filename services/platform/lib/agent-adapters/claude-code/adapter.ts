// Claude Code adapter — builds the headless `claude -p` exec + parses its
// stream-json output. The container is the safety boundary, so we run with
// bypassPermissions (permitted because the agent-profile user is non-root).

import type { AgentEventParser } from '../events';
import type { AgentAdapter, AgentRunSpec, SessionExecSpec } from '../types';
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

/** Human-control bridge (browserCdp only). A dependency-free stdio shim that
 * exposes `request_human_control({reason})`. The tool makes NO network call —
 * the platform observes the tool_use in stream-json (run_agent) and raises a
 * take-control card + parks the turn. Only meaningful when the live headed
 * browser exists (browserCdp), since a human drives it via the x11vnc path. */
const HUMAN_CONTROL_MCP_SERVER = {
  command: 'tale-human-control-mcp',
};

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly slug = 'claude-code' as const;

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
    if (spec.agentSessionId) argv.push('--resume', spec.agentSessionId);
    if (spec.model) argv.push('--model', spec.model);
    if (spec.systemPromptAppend) {
      argv.push('--append-system-prompt', spec.systemPromptAppend);
    }
    // One merged --mcp-config (Playwright + the integration bridge), isolated
    // from the repo's own .mcp.json via --strict-mcp-config so a run is
    // reproducible regardless of repo contents.
    const mcpServers: Record<string, unknown> = {};
    if (spec.browserMcp !== false) {
      // browserCdp: attach to the session's externally-launched headed Chromium
      // over CDP (read-only mirror); otherwise self-launch headless as today.
      mcpServers.playwright =
        spec.browserCdp === true
          ? PLAYWRIGHT_MCP_CDP_SERVER
          : PLAYWRIGHT_MCP_SERVER;
      // Human takeover only applies to the live headed browser (browserCdp) —
      // that's the one a human can drive via x11vnc. The self-launched headless
      // browser has no VNC surface, so the tool would be a dead end there.
      // Autonomous runs have no human to take over, so the tool is never offered.
      if (spec.browserCdp === true && spec.interactionMode !== 'autonomous') {
        mcpServers.humanControl = HUMAN_CONTROL_MCP_SERVER;
      }
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
      env.ANTHROPIC_MODEL = spec.model;
      if (!byo) {
        // MANAGED: pin every default-model slot to the gateway model so Claude
        // Code doesn't 404 resolving opus/sonnet/haiku/fable aliases against the
        // VK's single-model allowlist. BYO has no such allowlist, so leave the
        // alias + subagent slots to the CLI / credential defaults.
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = spec.model;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = spec.model;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = spec.model;
        env.ANTHROPIC_DEFAULT_FABLE_MODEL = spec.model;
        // The session VK only allows the selected model, so a subagent whose
        // frontmatter names a concrete model id would be rejected at the
        // gateway; this slot outranks frontmatter and pins them all.
        env.CLAUDE_CODE_SUBAGENT_MODEL = spec.model;
      }
    }

    return {
      argv,
      env,
      cwd: spec.workdir,
      stdin: buildStdinUserMessage(spec.prompt),
      stdinMode: 'hold',
    };
  }

  createParser(): AgentEventParser {
    return new ClaudeCodeParser();
  }
}
