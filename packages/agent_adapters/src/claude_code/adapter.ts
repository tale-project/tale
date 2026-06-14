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
  args: ['--headless', '--browser', 'chromium', '--isolated', '--no-sandbox'],
};

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly slug = 'claude-code' as const;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
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
      mcpServers.playwright = PLAYWRIGHT_MCP_SERVER;
    }
    if (spec.integrationsBaseUrl) {
      // The integration-dispatch bridge — lets the agent use the org's connected
      // integrations. The credential stays server-side; the bridge only relays
      // {slug, operation, args} to the platform, authed by the session key.
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
    // Deny the built-in server-side WebSearch — search goes only through a
    // connected search integration (e.g. Tavily) via the dispatch bridge, so
    // behavior is consistent across models and the call is metered + audited.
    argv.push('--disallowedTools', 'WebSearch');

    const env: Record<string, string> = {
      // Anthropic Messages route on the gateway; the session key is a bearer
      // token (ANTHROPIC_AUTH_TOKEN takes precedence over X-Api-Key).
      ANTHROPIC_BASE_URL: `${spec.gateway.baseUrl}/anthropic`,
      ANTHROPIC_AUTH_TOKEN: spec.gateway.token,
      // Blank the API key so it never conflicts with the bearer token
      // (documented Claude Code gotcha → model-not-found otherwise).
      ANTHROPIC_API_KEY: '',
      CLAUDE_CONFIG_DIR: '/workspace/.home/.claude',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
    if (spec.execId) {
      // Mid-turn steering: the in-image tale-steer-hook (registered via
      // managed-settings PostToolUse/Stop hooks) reads this per-exec dir and
      // injects any platform-staged user messages at the next boundary.
      env.TALE_STEER_DIR = `/workspace/.tale/steer/${spec.execId}`;
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
      // Set every default-model slot to the gateway model so Claude Code
      // doesn't intermittently 404 resolving opus/sonnet/haiku/fable aliases.
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = spec.model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = spec.model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = spec.model;
      env.ANTHROPIC_DEFAULT_FABLE_MODEL = spec.model;
      // The session VK only allows the selected model, so a subagent whose
      // frontmatter names a concrete model id would be rejected at the
      // gateway; this slot outranks frontmatter and pins them all.
      env.CLAUDE_CODE_SUBAGENT_MODEL = spec.model;
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
