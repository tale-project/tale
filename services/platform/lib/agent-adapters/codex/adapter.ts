// Codex CLI adapter — builds the headless `codex exec --json` invocation and
// parses its JSONL output. All configuration rides `-c key=value` overrides
// (the only config surface `codex exec resume` shares with a fresh
// `codex exec` — resume has no -s/-C/--add-dir flags; verified on the pinned
// codex-cli 0.142.5). Managed runs route model calls through the platform LLM
// gateway via a custom model provider (`model_providers.tale`) whose bearer
// key is read from the session env (`env_key`), so the virtual key never
// appears on argv. BYO defines the same provider shape against OpenAI's own
// API with the user-injected OPENAI_API_KEY — no `codex login` state needed.
//
// The tale-daemon local-board adapter (tools/cli/src/daemon/adapters/codex.ts)
// drives the same CLI on a user's machine; THIS module is the source of truth
// for argv/parse quirks — keep the two in sync.

import type { AgentEventParser } from '../events';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunSpec,
  CredentialPolicy,
  SessionExecSpec,
} from '../types';
import { CodexParser } from './parse';

/** Session-relative Codex state root under HOME (/user/.runtime/home).
 * Sessions (the resume store), logs, and auto-written trust state live here,
 * on the /user volume, so `codex exec resume` finds the thread across turns. */
const CODEX_HOME = '/user/.runtime/home/.codex';

/** Session-relative user-level skills dir. Codex discovers user-scope skills
 * at `$HOME/.agents/skills` (SKILL.md folders — Codex skills docs; HOME is
 * /user/.runtime/home in a session container). */
const CODEX_SKILLS_STAGE_DIR = '.runtime/home/.agents/skills' as const;

/** Gateway provider id inside the Codex config (`model_providers.<id>`). */
const TALE_PROVIDER = 'tale';

/** Self-launch headless Playwright MCP (see claude-code/adapter.ts for the
 * flag rationale — the shim bridges the egress proxy env into Chromium). */
const PLAYWRIGHT_MCP_ARGS = [
  '--headless',
  '--browser',
  'chromium',
  '--isolated',
  '--no-sandbox',
  '--ignore-https-errors',
];

/** Live browser view: attach to the session's headed Chromium over CDP. */
const PLAYWRIGHT_MCP_CDP_ARGS = ['--cdp-endpoint', 'http://127.0.0.1:9222'];

const CREDENTIAL_POLICY: CredentialPolicy = {
  managedSource: 'gateway',
  // BYO talks to OpenAI's own API (OPENAI_API_KEY) — request the catalog
  // entry's `nativeModelId` (`gpt-5.5`), not the vendor-prefixed catalog id.
  byoModelIdSource: 'vendor-native',
  supportsByo: true,
  supportsManaged: true,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'one-shot',
  // Raw prompt text on stdin behind the `-` sentinel (no NDJSON envelope).
  promptTransport: 'stdin-text',
  mcpDelivery: 'inline-argv',
  supportsPlanMode: false,
  supportsMidTurnSteering: false,
  // Codex runs with `sandbox_mode = "danger-full-access"` (the container is
  // the boundary), which imposes no path scoping — staged attachment dirs
  // outside the workdir are readable without per-dir grants, so no flag is
  // needed (and `codex exec resume` has no --add-dir anyway).
  supportsAttachmentDirs: true,
  supportsIntegrationsBridge: true,
  supportsVisionPolyfill: false,
  skillsStageDir: CODEX_SKILLS_STAGE_DIR,
};

const CREDENTIAL_ENV_KEYS = ['OPENAI_API_KEY', 'TALE_GATEWAY_TOKEN'] as const;

/** One `-c key=value` override. `value` must already be TOML-serialized
 * (quoted string, array, …) — the CLI parses the value portion as TOML. */
function pushConfig(argv: string[], key: string, tomlValue: string): void {
  argv.push('-c', `${key}=${tomlValue}`);
}

/** TOML basic string (double-quoted, escapes backslash/quote/control). */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((v) => tomlString(v)).join(',')}]`;
}

export class CodexAdapter implements AgentAdapter {
  readonly slug = 'codex' as const;
  readonly credentialPolicy = CREDENTIAL_POLICY;
  readonly capabilities = CAPABILITIES;
  readonly credentialEnvKeys = CREDENTIAL_ENV_KEYS;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    const byo = spec.authMode === 'byo';
    // Resume is a SUBCOMMAND (`codex exec resume <id>`), not a flag, and it
    // accepts only the shared option set (-c/-m/--json/--skip-git-repo-check…)
    // — the posture flags below therefore all ride `-c` so fresh and resumed
    // turns are configured identically (verified 0.142.5).
    const argv = spec.agentSessionId
      ? ['codex', 'exec', 'resume', spec.agentSessionId]
      : ['codex', 'exec'];
    argv.push('--json', '--skip-git-repo-check');

    // Non-interactive full-access posture: the container (cap-drop, egress
    // proxy, non-root) is the safety boundary, so Codex's own OS sandbox and
    // approval prompts are disabled. NOTE: `codex exec` has no turn-cap flag —
    // `spec.maxTurns` is deliberately ignored; runaway protection is the
    // platform's exec timeout + action deadline (same posture as Cursor and
    // OpenCode). `spec.fallbackModel` is ignored too: Codex has no
    // availability-fallback chain (that concept is Claude Code's).
    pushConfig(argv, 'approval_policy', tomlString('never'));
    pushConfig(argv, 'sandbox_mode', tomlString('danger-full-access'));

    // Native web search is ungoverned (no integration audit /
    // untrusted-source wrapping / metering) AND defaults to "live" under a
    // full-access sandbox — so managed runs force-disable it per the
    // AgentRunSpec.nativeWebTools contract; web access routes through a
    // connected integration via the dispatch bridge. `nativeWebTools === true`
    // lifts the denial; BYO opts out of platform governance entirely.
    // (The interactive `request_user_input` tool needs no denial: `codex exec`
    // auto-declines it — "request_user_input is unavailable in Default mode",
    // verified 0.142.5 — and the agent asks in prose instead.)
    if (!byo && spec.nativeWebTools !== true) {
      pushConfig(argv, 'web_search', tomlString('disabled'));
    }

    // Model provider. Codex 0.142.5 speaks ONLY the OpenAI Responses API
    // (`wire_api = "chat"` is a startup error) — the platform gateway serves
    // /openai/v1/responses and translates Responses→Chat for chat-only
    // upstreams. The bearer key is read from the session env via `env_key`,
    // never placed on argv (process lists leak argv).
    if (!byo && spec.gateway) {
      pushConfig(argv, 'model_provider', tomlString(TALE_PROVIDER));
      pushConfig(
        argv,
        `model_providers.${TALE_PROVIDER}.name`,
        tomlString('Tale Gateway'),
      );
      pushConfig(
        argv,
        `model_providers.${TALE_PROVIDER}.base_url`,
        tomlString(`${spec.gateway.baseUrl}/openai/v1`),
      );
      pushConfig(
        argv,
        `model_providers.${TALE_PROVIDER}.env_key`,
        tomlString('TALE_GATEWAY_TOKEN'),
      );
      pushConfig(
        argv,
        `model_providers.${TALE_PROVIDER}.wire_api`,
        tomlString('responses'),
      );
    }
    if (byo) {
      // Same provider shape against OpenAI's own API: `env_key` reads the
      // user-injected OPENAI_API_KEY directly, so no `codex login` /
      // auth.json state is required in the container.
      pushConfig(argv, 'model_provider', tomlString(TALE_PROVIDER));
      pushConfig(
        argv,
        `model_providers.${TALE_PROVIDER}.name`,
        tomlString('OpenAI'),
      );
      pushConfig(
        argv,
        `model_providers.${TALE_PROVIDER}.base_url`,
        tomlString('https://api.openai.com/v1'),
      );
      pushConfig(
        argv,
        `model_providers.${TALE_PROVIDER}.env_key`,
        tomlString('OPENAI_API_KEY'),
      );
      pushConfig(
        argv,
        `model_providers.${TALE_PROVIDER}.wire_api`,
        tomlString('responses'),
      );
    }

    // systemPromptAppend (org systemInstructions + trust rules + skills
    // guidance) rides the `developer_instructions` config key — Codex injects
    // it as a developer message ahead of the user turn (verified 0.142.5: the
    // text lands verbatim in the request's developer message). Never dropped.
    if (spec.systemPromptAppend) {
      pushConfig(
        argv,
        'developer_instructions',
        tomlString(spec.systemPromptAppend),
      );
    }

    const env: Record<string, string> = {
      CODEX_HOME,
    };
    if (!byo && spec.gateway) {
      env.TALE_GATEWAY_TOKEN = spec.gateway.token;
    }

    // MCP servers (`mcp_servers.<id>` config). Secrets reach the bridge via
    // the `env_vars` whitelist — Codex forwards ONLY whitelisted vars from its
    // own process env to MCP stdio servers (verified 0.142.5), so the session
    // key stays out of argv.
    if (spec.browserMcp !== false) {
      pushConfig(
        argv,
        'mcp_servers.playwright.command',
        tomlString('tale-playwright-mcp'),
      );
      pushConfig(
        argv,
        'mcp_servers.playwright.args',
        tomlStringArray(
          spec.browserCdp === true
            ? PLAYWRIGHT_MCP_CDP_ARGS
            : PLAYWRIGHT_MCP_ARGS,
        ),
      );
    }
    if (spec.integrationsBaseUrl && spec.gateway) {
      // Integration-dispatch bridge — managed-only (authed by the session
      // key; BYO runs carry no gateway key and therefore no bridge).
      pushConfig(
        argv,
        'mcp_servers.integrations.command',
        tomlString('tale-integrations-mcp'),
      );
      pushConfig(
        argv,
        'mcp_servers.integrations.env_vars',
        tomlStringArray(['TALE_INTEGRATIONS_URL', 'TALE_INTEGRATIONS_TOKEN']),
      );
      env.TALE_INTEGRATIONS_URL = spec.integrationsBaseUrl;
      env.TALE_INTEGRATIONS_TOKEN = spec.gateway.token;
    }

    // Model: managed = the gateway model id (matches the VK allowlist); BYO =
    // the catalog's vendor-native id or the raw user-typed id (exec_model.ts).
    // Omitted when unset so the CLI's own default applies.
    if (spec.model) {
      argv.push('-m', spec.model);
    }

    // Prompt rides stdin via the `-` sentinel, never argv: process lists leak
    // argv, and a prompt starting with '-' would parse as a flag. The trailing
    // positional must come AFTER every option.
    argv.push('-');

    return {
      argv,
      env,
      cwd: spec.workdir,
      stdin: spec.prompt,
      stdinMode: 'close',
    };
  }

  createParser(): AgentEventParser {
    return new CodexParser();
  }
}
