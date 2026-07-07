// OpenClaw adapter — headless `openclaw agent --local --json` driven through
// the `tale-openclaw-run` wrapper. Managed runs route model calls through the
// platform LLM gateway's OpenAI-compatible route via a generated `tale`
// provider in the per-exec OpenClaw config (baseUrl = <gateway>/openai/v1,
// apiKey = the session virtual key via `${TALE_GATEWAY_TOKEN}` — OpenClaw's
// SecretInput env template, so the staged config never carries the key). BYO
// uses the credentials the user injected into the session env (OpenClaw
// resolves ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / … per
// provider natively).
//
// Everything here is verified against the pinned openclaw 2026.6.11 (flags,
// config schema, session semantics — see the wrapper's header for the full
// mechanism notes). The CLI has NO streaming output in headless mode (`--json`
// prints ONE final envelope), so a turn renders as run-started → final text →
// usage → result; the in-run tool timeline is not observable.

import type { AgentEventParser } from '../events';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunSpec,
  CredentialPolicy,
  SessionExecSpec,
} from '../types';
import { OpenClawParser } from './parse';

/** Session-relative OpenClaw state dir under HOME (/user/.runtime/home). The
 * session store (per-thread resume) and managed skills live here. */
const OPENCLAW_STATE_DIR = '/user/.runtime/home/.openclaw';

/** Session-relative managed-skills dir. Verified 2026.6.11: managed skills
 * load from `<state dir>/skills` (skills/loading/workspace.ts,
 * managedSkillsDir = CONFIG_DIR/skills), SKILL.md format — Claude-compatible,
 * so Tale's staged skills work unchanged. */
const OPENCLAW_SKILLS_STAGE_DIR = '.runtime/home/.openclaw/skills' as const;

/** Self-launch headless Playwright MCP (see claude-code/adapter.ts for the
 * flag rationale). OpenClaw takes MCP servers via the config `mcp.servers`
 * map (stdio: command/args/env — verified 2026.6.11 McpServerConfig; the
 * embedded agent loop attaches them via agent-bundle-mcp-runtime). */
const PLAYWRIGHT_MCP_SERVER = {
  command: 'tale-playwright-mcp',
  args: [
    '--headless',
    '--browser',
    'chromium',
    '--isolated',
    '--no-sandbox',
    '--ignore-https-errors',
  ],
};

/** Live browser view: attach to the session's headed Chromium over CDP. */
const PLAYWRIGHT_MCP_CDP_SERVER = {
  command: 'tale-playwright-mcp',
  args: ['--cdp-endpoint', 'http://127.0.0.1:9222'],
};

const CREDENTIAL_POLICY: CredentialPolicy = {
  managedSource: 'gateway',
  // OpenClaw's own model refs are `vendor/model` — the catalog id's exact
  // grammar (`anthropic/claude-sonnet-4.6`) — so a catalog-shaped BYO ref maps
  // to the catalog id. A raw user-typed ref (the normal BYO case; shipped BYO
  // agents carry no models) passes through unchanged either way.
  byoModelIdSource: 'catalog',
  supportsByo: true,
  supportsManaged: true,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'one-shot',
  // Prompt + system-prompt append + generated config ride ONE JSON payload on
  // the wrapper's stdin; the wrapper stages them to disk (message file,
  // OPENCLAW_CONFIG_PATH, workspace AGENTS.md) before the CLI starts.
  promptTransport: 'stdin-ndjson',
  mcpDelivery: 'staged-file',
  supportsPlanMode: false,
  supportsMidTurnSteering: false,
  // OpenClaw's file tools are unrestricted by default (verified 2026.6.11
  // FsToolsConfig.workspaceOnly defaults false), so out-of-cwd staging dirs
  // (e.g. /user/uploads) are readable without an explicit grant.
  supportsAttachmentDirs: true,
  supportsIntegrationsBridge: true,
  supportsVisionPolyfill: false,
  skillsStageDir: OPENCLAW_SKILLS_STAGE_DIR,
};

const CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'TALE_GATEWAY_TOKEN',
] as const;

export class OpenClawAdapter implements AgentAdapter {
  readonly slug = 'openclaw' as const;
  readonly credentialPolicy = CREDENTIAL_POLICY;
  readonly capabilities = CAPABILITIES;
  readonly credentialEnvKeys = CREDENTIAL_ENV_KEYS;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    const byo = spec.authMode === 'byo';
    const argv = ['tale-openclaw-run', '--workdir', spec.workdir];
    // Resume handle: the wrapper passes it as `--session-id`, OpenClaw's
    // explicit-session selector (key `agent:main:explicit:<id>`, persisted in
    // the state-dir session store) — the same id continues the same
    // conversation. First turns mint a fresh id in the wrapper, reported via
    // the run_start/run_end events.
    if (spec.agentSessionId) argv.push('--resume', spec.agentSessionId);

    // Managed: the gateway model id behind the generated `tale` provider
    // (OpenClaw refs split provider/model at the FIRST slash, so slashed
    // gateway ids survive as the model id — verified 2026.6.11 parseModelRef).
    // BYO: the mapped catalog id / raw user-typed ref, passed through.
    const primaryModel = spec.model
      ? byo
        ? spec.model
        : `tale/${spec.model}`
      : undefined;
    // Managed model-level fallback (catalog fallbackModelId): OpenClaw has a
    // native fallback chain (`agents.defaults.model.fallbacks`), and the
    // session VK is scoped to allow the fallback alongside the primary.
    const fallbackModel =
      !byo && spec.fallbackModel && spec.fallbackModel !== spec.model
        ? `tale/${spec.fallbackModel}`
        : undefined;

    // `spec.maxTurns` is deliberately ignored: the pinned CLI has no per-run
    // tool-iteration cap (its `runRetries` config bounds retry loops, not
    // turns). The platform exec deadline is the runaway backstop.
    const agentDefaults: Record<string, unknown> = {
      // The agent workspace doubles as the exec/file-tool default cwd. The
      // wrapper stages the per-exec system-prompt append as AGENTS.md at this
      // root (OpenClaw injects workspace bootstrap files into the system
      // prompt every turn); skipBootstrap stops the CLI from seeding its own
      // bootstrap files (or git-init) into the shared Tale workspace.
      workspace: spec.workdir,
      skipBootstrap: true,
    };
    if (primaryModel) {
      agentDefaults.model = {
        primary: primaryModel,
        ...(fallbackModel && { fallbacks: [fallbackModel] }),
      };
    }

    const config: Record<string, unknown> = {
      agents: { defaults: agentDefaults },
      // `coding` profile: files/runtime/web/memory/session tools only — no
      // `message` (channel delivery), no `gateway` (self-admin), and no
      // interactive-question tool exists in this runtime. Deny the NATIVE web
      // tools (web_search + web_fetch + x_search) on managed runs: all are
      // ungoverned (no integration audit / untrusted-source wrapping /
      // metering) — web access routes through a connected integration via the
      // dispatch bridge instead. `spec.nativeWebTools === true` lifts the
      // denial; BYO opts out of platform governance, so it runs native.
      tools: {
        profile: 'coding',
        ...(!byo &&
          spec.nativeWebTools !== true && {
            deny: ['web_search', 'web_fetch', 'x_search'],
          }),
      },
    };

    if (!byo && spec.gateway) {
      // MANAGED: OpenAI-compatible route on the platform gateway. The apiKey
      // rides `${TALE_GATEWAY_TOKEN}` — OpenClaw's SecretInput env template
      // (verified 2026.6.11 ENV_SECRET_TEMPLATE_RE) — so the staged config
      // file never contains the key itself.
      const models = [primaryModel, fallbackModel]
        .filter((m): m is string => m !== undefined)
        .map((m) => ({
          id: m.slice('tale/'.length),
          name: 'Tale gateway model',
          // Generic OpenAI-compat metering through the gateway; thinking
          // controls are provider-specific and not exposed here.
          reasoning: false,
          input: ['text', 'image'],
          // Zero cost rows: the gateway meters authoritatively; a client-side
          // estimate would only fabricate numbers.
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200_000,
          maxTokens: 32_000,
        }));
      config.models = {
        providers: {
          tale: {
            baseUrl: `${spec.gateway.baseUrl}/openai/v1`,
            apiKey: '${TALE_GATEWAY_TOKEN}',
            api: 'openai-completions',
            models,
          },
        },
      };
    }
    // BYO: no gateway provider — OpenClaw resolves the user-injected session
    // credentials (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, …) natively.

    const mcpServers: Record<string, unknown> = {};
    if (spec.browserMcp !== false) {
      mcpServers.playwright =
        spec.browserCdp === true
          ? PLAYWRIGHT_MCP_CDP_SERVER
          : PLAYWRIGHT_MCP_SERVER;
    }
    if (spec.integrationsBaseUrl && spec.gateway) {
      // Integration-dispatch bridge (managed-only — authed by the session
      // key). OpenClaw's MCP stdio child env is NOT env-template-resolved, so
      // the wrapper substitutes `${TALE_GATEWAY_TOKEN}` from its own environ
      // when staging the config (mcp env values only) — the payload that
      // crosses the exec API still carries the placeholder, not the key.
      mcpServers.integrations = {
        command: 'tale-integrations-mcp',
        env: {
          TALE_INTEGRATIONS_URL: spec.integrationsBaseUrl,
          TALE_INTEGRATIONS_TOKEN: '${TALE_GATEWAY_TOKEN}',
        },
      };
    }
    if (Object.keys(mcpServers).length > 0) {
      config.mcp = { servers: mcpServers };
    }

    const env: Record<string, string> = {
      // Persistent per-session state (session store → per-thread resume,
      // managed skills). Under /user/.runtime/home so it survives container
      // stops like every other runtime profile dir.
      OPENCLAW_STATE_DIR,
    };
    if (!byo && spec.gateway) {
      env.TALE_GATEWAY_TOKEN = spec.gateway.token;
    }

    // Prompt + system-prompt append + config travel as ONE JSON object on
    // stdin, never argv: process lists leak argv, and a prompt starting with
    // '-' would parse as a flag. The wrapper stages the config
    // (OPENCLAW_CONFIG_PATH), the prompt (--message-file) and the append
    // (workspace AGENTS.md) before the CLI starts.
    const stdinPayload: Record<string, unknown> = {
      prompt: spec.prompt,
      config,
    };
    if (spec.systemPromptAppend) {
      // Delivered as the workspace AGENTS.md bootstrap file — OpenClaw
      // appends workspace bootstrap files to its system prompt every turn
      // WITHOUT replacing its core prompt (verified 2026.6.11
      // loadWorkspaceBootstrapFiles → resolveBootstrapFilesForRun). The
      // wrapper backs up any pre-existing AGENTS.md and restores it after.
      stdinPayload.system_prompt = spec.systemPromptAppend;
    }

    return {
      argv,
      env,
      cwd: spec.workdir,
      stdin: JSON.stringify(stdinPayload),
      stdinMode: 'close',
    };
  }

  createParser(): AgentEventParser {
    return new OpenClawParser();
  }
}
