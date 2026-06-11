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
          command: ['mcp-server-playwright', '--headless'],
          enabled: true,
        },
      };
    }

    const argv = ['opencode', 'run', '--format', 'json', '--dir', spec.workdir];
    if (spec.agentSessionId) argv.push('-s', spec.agentSessionId);
    argv.push('-m', taleModel);
    // Prompt as the trailing positional (argv element — no shell).
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
