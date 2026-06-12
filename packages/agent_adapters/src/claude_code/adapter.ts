// Claude Code adapter — builds the headless `claude -p` exec + parses its
// stream-json output. The container is the safety boundary, so we run with
// bypassPermissions (permitted because the agent-profile user is non-root).

import type { AgentEventParser } from '../events';
import type { AgentAdapter, AgentRunSpec, SessionExecSpec } from '../types';
import { DEFAULT_MAX_TURNS } from '../types';
import { ClaudeCodeParser } from './parse';

/** In-container Playwright MCP launch (stdio). `--strict-mcp-config` isolates
 * the user repo's own .mcp.json so a run is reproducible regardless of repo
 * contents. tale-playwright-mcp is the image's launcher shim — it bridges the
 * container's HTTPS_PROXY/NO_PROXY into --proxy-server/--proxy-bypass
 * (Chromium ignores the env vars; the sandbox network is internal-only). */
const PLAYWRIGHT_MCP_CONFIG = JSON.stringify({
  mcpServers: {
    playwright: {
      command: 'tale-playwright-mcp',
      // --browser chromium: the image ships chromium, not the default Google
      //   Chrome channel.
      // --isolated: in-memory profile — the default persistent profile dir
      //   lives under PLAYWRIGHT_BROWSERS_PATH, read-only at runtime.
      // --no-sandbox: the session container (cap-drop=ALL, no-new-privileges)
      //   has no unprivileged userns, so Chromium's zygote sandbox aborts at
      //   launch; the container itself is the isolation boundary.
      args: [
        '--headless',
        '--browser',
        'chromium',
        '--isolated',
        '--no-sandbox',
      ],
    },
  },
});

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly slug = 'claude-code' as const;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    const argv = [
      'claude',
      '-p',
      '--output-format',
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
    if (spec.browserMcp !== false) {
      argv.push('--mcp-config', PLAYWRIGHT_MCP_CONFIG, '--strict-mcp-config');
    }

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
      // Set all three default-model slots to the gateway model so Claude Code
      // doesn't intermittently 404 resolving opus/sonnet/haiku aliases.
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = spec.model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = spec.model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = spec.model;
    }

    return { argv, env, cwd: spec.workdir, stdin: spec.prompt };
  }

  createParser(): AgentEventParser {
    return new ClaudeCodeParser();
  }
}
