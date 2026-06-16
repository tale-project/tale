// OpenCode adapter — builds the headless `opencode run --format json` exec and
// parses its JSONL output. Config is injected via OPENCODE_CONFIG_CONTENT (the
// gateway provider + permission policy) so nothing depends on a repo-local
// opencode.json; the session key rides TALE_GATEWAY_TOKEN (referenced via
// {env:…} so it never appears in the config JSON itself, which may get logged).

import type { AgentEventParser } from '../events';
import type { AgentAdapter, AgentRunSpec, SessionExecSpec } from '../types';
import { OpenCodeParser } from './parse';

interface OpenCodeConfig {
  $schema: string;
  provider: Record<string, unknown>;
  model: string;
  permission: string;
  share: string;
  autoupdate: boolean;
  mcp?: Record<string, unknown>;
}

const TALE_PROVIDER = 'tale';

export class OpenCodeAdapter implements AgentAdapter {
  readonly slug = 'opencode' as const;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    const modelId = spec.model ?? 'default';
    const taleModel = `${TALE_PROVIDER}/${modelId}`;

    const config: OpenCodeConfig = {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        [TALE_PROVIDER]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Tale Gateway',
          options: {
            // OpenAI-compatible route on the gateway.
            baseURL: `${spec.gateway.baseUrl}/openai/v1`,
            apiKey: '{env:TALE_GATEWAY_TOKEN}',
          },
          models: { [modelId]: { name: modelId } },
        },
      },
      model: taleModel,
      // The container is the safety boundary → auto-approve every tool/edit/
      // bash/external-dir action; no SSE permission prompts in run-mode.
      permission: 'allow',
      share: 'disabled',
      autoupdate: false,
    };
    if (spec.browserMcp !== false) {
      config.mcp = {
        playwright: {
          type: 'local',
          // tale-playwright-mcp: image launcher shim that bridges
          // HTTPS_PROXY/NO_PROXY into Chromium proxy flags. --browser
          // chromium (the image ships no Google Chrome channel) + --isolated
          // (in-memory profile; PLAYWRIGHT_BROWSERS_PATH is read-only) +
          // --no-sandbox (no unprivileged userns under cap-drop=ALL; the
          // container is the isolation boundary) + --ignore-https-errors (the
          // apps the agent tests serve over localhost with a self-signed cert
          // or no TLS; without it navigation fails closed with
          // ERR_CERT_AUTHORITY_INVALID and there is no per-navigation
          // override).
          command: [
            'tale-playwright-mcp',
            '--headless',
            '--browser',
            'chromium',
            '--isolated',
            '--no-sandbox',
            '--ignore-https-errors',
          ],
          enabled: true,
        },
      };
    }

    const argv = ['opencode', 'run', '--format', 'json', '--dir', spec.workdir];
    if (spec.agentSessionId) argv.push('-s', spec.agentSessionId);
    argv.push('-m', taleModel);
    // Prompt as the trailing positional (argv element — no shell). Unlike the
    // SessionExecSpec stdin contract (Claude Code rides stdin), `opencode run`
    // only accepts the prompt as a positional `[message..]` argument — it has
    // no stdin/`-` prompt source — so it cannot honor the argv-leak guard. This
    // is the agent's documented CLI surface, not a leak we can avoid here.
    argv.push(spec.prompt);

    const env: Record<string, string> = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      TALE_GATEWAY_TOKEN: spec.gateway.token,
    };

    return { argv, env, cwd: spec.workdir };
  }

  createParser(): AgentEventParser {
    return new OpenCodeParser();
  }
}
