// OpenCode adapter — builds the headless `opencode run --format json` exec and
// parses its JSONL output. Config is injected via OPENCODE_CONFIG_CONTENT (the
// gateway provider + permission policy) so nothing depends on a repo-local
// opencode.json; the session key rides TALE_GATEWAY_TOKEN (referenced via
// {env:…} so it never appears in the config JSON itself, which may get logged).

import type { AgentEventParser } from '../events';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunSpec,
  CredentialPolicy,
  SessionExecSpec,
} from '../types';
import { CLAUDE_COMPAT_SKILLS_STAGE_DIR } from '../types';
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

/** Self-launch headless Playwright MCP (see claude-code/adapter.ts). */
const PLAYWRIGHT_MCP_COMMAND = [
  'tale-playwright-mcp',
  '--headless',
  '--browser',
  'chromium',
  '--isolated',
  '--no-sandbox',
  '--ignore-https-errors',
];

/** Live browser view: attach to the session's headed Chromium over CDP. */
const PLAYWRIGHT_MCP_CDP_COMMAND = [
  'tale-playwright-mcp',
  '--cdp-endpoint',
  'http://127.0.0.1:9222',
];

const CREDENTIAL_POLICY: CredentialPolicy = {
  managedSource: 'gateway',
  supportsByo: false,
  supportsManaged: true,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'one-shot',
  promptTransport: 'argv-positional',
  mcpDelivery: 'inline-env',
  supportsPlanMode: false,
  supportsMidTurnSteering: false,
  supportsAttachmentDirs: false,
  supportsIntegrationsBridge: true,
  supportsVisionPolyfill: false,
  // Baked-in + integration skills symlink into .claude/skills in the image;
  // OpenCode reads the same compat tree in practice.
  skillsStageDir: CLAUDE_COMPAT_SKILLS_STAGE_DIR,
};

const CREDENTIAL_ENV_KEYS = ['TALE_GATEWAY_TOKEN'] as const;

export class OpenCodeAdapter implements AgentAdapter {
  readonly slug = 'opencode' as const;
  readonly credentialPolicy = CREDENTIAL_POLICY;
  readonly capabilities = CAPABILITIES;
  readonly credentialEnvKeys = CREDENTIAL_ENV_KEYS;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    if (spec.authMode === 'byo' || !spec.gateway) {
      // OpenCode is managed-only: its provider config points at the gateway and
      // authenticates with the virtual key. BYO (no gateway) is unsupported.
      throw new Error(
        'OpenCode requires the managed gateway; authMode "byo" is not supported for OpenCode.',
      );
    }
    const modelId = spec.model ?? 'default';
    const taleModel = `${TALE_PROVIDER}/${modelId}`;

    const config: OpenCodeConfig = {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        [TALE_PROVIDER]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Tale Gateway',
          options: {
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

    const mcpServers: Record<string, unknown> = {};
    if (spec.browserMcp !== false) {
      mcpServers.playwright = {
        type: 'local',
        command:
          spec.browserCdp === true
            ? PLAYWRIGHT_MCP_CDP_COMMAND
            : PLAYWRIGHT_MCP_COMMAND,
        enabled: true,
      };
    }
    if (spec.integrationsBaseUrl && spec.gateway) {
      mcpServers.integrations = {
        type: 'local',
        command: ['tale-integrations-mcp'],
        env: {
          TALE_INTEGRATIONS_URL: spec.integrationsBaseUrl,
          TALE_INTEGRATIONS_TOKEN: spec.gateway.token,
        },
        enabled: true,
      };
    }
    if (Object.keys(mcpServers).length > 0) {
      config.mcp = mcpServers;
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

    return { argv, env, cwd: spec.workdir, stdinMode: 'close' };
  }

  createParser(): AgentEventParser {
    return new OpenCodeParser();
  }
}
