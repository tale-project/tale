// Claude Code adapter — builds the headless `claude -p` exec + parses its
// stream-json output. The container is the safety boundary, so we run with
// bypassPermissions (permitted because the agent-profile user is non-root).

import type { AgentEventParser } from '../events';
import type { AgentAdapter, AgentRunSpec, SessionExecSpec } from '../types';
import { DEFAULT_MAX_TURNS } from '../types';
import { ClaudeCodeParser } from './parse';

/** In-container Playwright MCP launch (stdio). `--strict-mcp-config` isolates
 * the user repo's own .mcp.json so a run is reproducible regardless of repo
 * contents. */
const PLAYWRIGHT_MCP_CONFIG = JSON.stringify({
  mcpServers: {
    playwright: {
      command: 'mcp-server-playwright',
      args: ['--headless'],
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
      'bypassPermissions',
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
