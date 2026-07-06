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
  permission: Record<string, 'ask' | 'allow' | 'deny'>;
  share: string;
  autoupdate: boolean;
  instructions?: string[];
  mcp?: Record<string, unknown>;
}

const TALE_PROVIDER = 'tale';

/** Session-relative stage path (under the /user mount — the sessionStageFiles
 * contract) of the per-exec instructions file that carries the composed
 * systemPromptAppend. Per-exec (like TALE_STEER_DIR) so concurrent turns from
 * other threads sharing the workspace never read each other's instructions. */
function opencodeInstructionsStagePath(execId: string): string {
  return `.runtime/tale/instructions/${execId}.md`;
}

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
    // `spec.maxTurns` is deliberately ignored: `opencode run` has no turn-cap
    // flag; runaway protection is the platform's exec timeout + action
    // deadline (same posture as the Cursor adapter). `spec.fallbackModel` is
    // ignored too — OpenCode has no availability-fallback chain (the
    // `--fallback-model` concept is Claude Code's).
    const modelId = spec.model ?? 'default';
    const taleModel = `${TALE_PROVIDER}/${modelId}`;

    // Permission policy (verified against OpenCode v1.17.3: a config-level
    // permission object merges LAST over the built-in agent defaults, and
    // within it the LAST matching key wins, so the tool denies below override
    // the leading wildcard). The container is the safety boundary → allow
    // every tool/edit/bash/external-dir action; no SSE permission prompts in
    // run-mode. Denies:
    //  - question: no answer path in our chat surface (mirrors Claude Code
    //    denying AskUserQuestion) — the agent asks in prose instead.
    //  - webfetch/websearch: OpenCode's NATIVE web tools are ungoverned (no
    //    integration audit / untrusted-source wrapping / metering), so managed
    //    runs force-disable them per the AgentRunSpec.nativeWebTools contract;
    //    web access routes through a connected integration via the dispatch
    //    bridge. `nativeWebTools === true` lifts that denial. (OpenCode has no
    //    BYO mode — it throws above — so there is no BYO carve-out here.)
    const permission: OpenCodeConfig['permission'] = {
      '*': 'allow',
      question: 'deny',
      ...(spec.nativeWebTools !== true && {
        webfetch: 'deny',
        websearch: 'deny',
      }),
    };

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
      permission,
      share: 'disabled',
      autoupdate: false,
    };

    // systemPromptAppend (org systemInstructions + trust rules + skills
    // guidance): OpenCode has no --append-system-prompt flag; its config
    // `instructions` entries are FILE paths whose content is appended to the
    // system prompt (absolute paths supported — verified v1.17.3
    // session/instruction.ts). Stage the composed text as a per-exec file and
    // reference it here; the runner writes `stagedFiles` before spawning.
    const stagedFiles: SessionExecSpec['stagedFiles'] = [];
    if (spec.systemPromptAppend) {
      const stagePath = opencodeInstructionsStagePath(spec.execId ?? 'default');
      stagedFiles.push({ path: stagePath, content: spec.systemPromptAppend });
      config.instructions = [`/user/${stagePath}`];
    }

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
        // `environment`, not `env` — OpenCode's McpLocalConfig only knows
        // `environment` (additionalProperties: false; verified v1.17.3), so an
        // `env` key never reaches the bridge process. The session key rides
        // {env:…} like the provider apiKey above (config may get logged);
        // TALE_GATEWAY_TOKEN is set in the exec env below and OpenCode
        // substitutes {env:VAR} from its process env when loading
        // OPENCODE_CONFIG_CONTENT.
        environment: {
          TALE_INTEGRATIONS_URL: spec.integrationsBaseUrl,
          TALE_INTEGRATIONS_TOKEN: '{env:TALE_GATEWAY_TOKEN}',
        },
        enabled: true,
      };
    }
    if (Object.keys(mcpServers).length > 0) {
      config.mcp = mcpServers;
    }

    const argv = ['opencode', 'run', '--format', 'json', '--dir', spec.workdir];
    if (spec.agentSessionId) argv.push('-s', spec.agentSessionId);
    // Mirror Claude Code omitting --model when none resolves: config.model
    // above is the default either way, so `-m` is only pushed for an explicit
    // selection.
    if (spec.model) argv.push('-m', taleModel);
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

    return {
      argv,
      env,
      cwd: spec.workdir,
      stdinMode: 'close',
      ...(stagedFiles.length > 0 && { stagedFiles }),
    };
  }

  createParser(): AgentEventParser {
    return new OpenCodeParser();
  }
}
