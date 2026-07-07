// Gemini CLI adapter — headless `gemini --output-format stream-json` driven
// through the `tale-gemini-run` wrapper. Managed runs route model calls
// through the platform LLM gateway's Google GenAI-compatible route
// (GOOGLE_GEMINI_BASE_URL = <gateway>/genai + the session virtual key as
// GEMINI_API_KEY); BYO uses the credentials the user injected into the
// session env (GEMINI_API_KEY, or GOOGLE_API_KEY + GOOGLE_GENAI_USE_VERTEXAI
// for Vertex).
//
// Everything here is verified against the pinned @google/gemini-cli 0.49.0
// (flags, settings schema, auth resolution — see the wrapper's header for the
// full mechanism notes).

import type { AgentEventParser } from '../events';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunSpec,
  CredentialPolicy,
  SessionExecSpec,
} from '../types';
import { DEFAULT_MAX_TURNS } from '../types';
import { GeminiCliParser } from './parse';

/** Session-relative Gemini user-skills dir under HOME (/user/.runtime/home).
 * Verified 0.49.0: Storage.getUserSkillsDir() = ~/.gemini/skills, loaded
 * regardless of workspace trust. */
const GEMINI_SKILLS_STAGE_DIR = '.runtime/home/.gemini/skills' as const;

/** Self-launch headless Playwright MCP (see claude-code/adapter.ts for the
 * flag rationale). Gemini CLI takes MCP servers via the settings `mcpServers`
 * map (stdio: command/args/env — verified 0.49.0 MCPServerConfig). */
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
  // BYO talks to Google's own GenAI/Vertex API — request the catalog
  // `nativeModelId` (`gemini-3.1-pro-preview`), not the gateway ref.
  byoModelIdSource: 'vendor-native',
  supportsByo: true,
  supportsManaged: true,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'one-shot',
  promptTransport: 'stdin-ndjson',
  // Settings (auth pin, tool excludes, MCP servers) ride the stdin payload and
  // are staged to disk by the wrapper before the CLI starts.
  mcpDelivery: 'staged-file',
  supportsPlanMode: false,
  supportsMidTurnSteering: false,
  supportsAttachmentDirs: true,
  supportsIntegrationsBridge: true,
  supportsVisionPolyfill: false,
  skillsStageDir: GEMINI_SKILLS_STAGE_DIR,
};

const CREDENTIAL_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GEMINI_BASE_URL',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'TALE_GATEWAY_TOKEN',
] as const;

export class GeminiCliAdapter implements AgentAdapter {
  readonly slug = 'gemini' as const;
  readonly credentialPolicy = CREDENTIAL_POLICY;
  readonly capabilities = CAPABILITIES;
  readonly credentialEnvKeys = CREDENTIAL_ENV_KEYS;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    const byo = spec.authMode === 'byo';
    const argv = ['tale-gemini-run', '--workdir', spec.workdir];
    if (spec.agentSessionId) argv.push('--resume', spec.agentSessionId);
    // Managed: the gateway model id (e.g. openrouter/google/gemini-3.1-pro-
    // preview — the /genai route's {model:*} matcher takes slashed ids). BYO:
    // the catalog's vendor-native id, else the raw user-typed id.
    // `spec.fallbackModel` is deliberately ignored: Gemini CLI has no
    // availability-fallback chain (the `--fallback-model` concept is Claude
    // Code's) — the turn runs entirely on the selected model.
    if (spec.model) argv.push('--model', spec.model);
    // Directories OUTSIDE cwd the agent must reach (e.g. the chat-upload
    // staging dir) — Gemini CLI's own `--include-directories` widens the
    // workspace context to them.
    for (const dir of spec.additionalDirs ?? []) {
      argv.push('--include-directories', dir);
    }

    // Settings staged by the wrapper as a per-exec SYSTEM settings file
    // (GEMINI_CLI_SYSTEM_SETTINGS_PATH) — system scope wins over any repo
    // .gemini/settings.json, so a run is reproducible regardless of repo
    // contents.
    const settings: Record<string, unknown> = {
      // Managed pins the auth type: with GOOGLE_GEMINI_BASE_URL set the CLI's
      // env inference selects the "gateway" auth type, which its headless
      // auth validation REJECTS (verified 0.49.0) — "gemini-api-key" + the
      // env base-URL override is the working path. BYO leaves the CLI's env
      // inference to pick GEMINI_API_KEY or the Vertex vars.
      ...(!byo && {
        security: { auth: { selectedType: 'gemini-api-key' } },
      }),
      privacy: { usageStatisticsEnabled: false },
      // Turn cap: FatalTurnLimitedError (exit 53) past this; the parser maps
      // its message to the 'max-turns' result status.
      model: { maxSessionTurns: spec.maxTurns ?? DEFAULT_MAX_TURNS },
    };
    // Deny the CLI's NATIVE web tools (google_web_search + web_fetch) on
    // managed runs: both are ungoverned (no integration audit /
    // untrusted-source wrapping / metering) — web access routes through a
    // connected integration via the dispatch bridge instead.
    // `spec.nativeWebTools === true` lifts the denial; BYO opts out of
    // platform governance, so it runs with the native toolset. The CLI's
    // interactive `ask_user` tool needs no deny here: headless mode
    // force-excludes it (verified 0.49.0 config.ts).
    if (!byo && spec.nativeWebTools !== true) {
      settings.tools = { exclude: ['google_web_search', 'web_fetch'] };
    }
    const mcpServers: Record<string, unknown> = {};
    if (spec.browserMcp !== false) {
      mcpServers.playwright =
        spec.browserCdp === true
          ? PLAYWRIGHT_MCP_CDP_SERVER
          : PLAYWRIGHT_MCP_SERVER;
    }
    if (spec.integrationsBaseUrl && spec.gateway) {
      // Integration-dispatch bridge (managed-only — authed by the session
      // key). The token rides `${TALE_GATEWAY_TOKEN}`: settings string values
      // are env-resolved at load (verified 0.49.0 envVarResolver), so the
      // staged settings file never contains the key itself.
      mcpServers.integrations = {
        command: 'tale-integrations-mcp',
        env: {
          TALE_INTEGRATIONS_URL: spec.integrationsBaseUrl,
          TALE_INTEGRATIONS_TOKEN: '${TALE_GATEWAY_TOKEN}',
        },
      };
    }
    if (Object.keys(mcpServers).length > 0) {
      settings.mcpServers = mcpServers;
    }

    const env: Record<string, string> = {};
    if (!byo && spec.gateway) {
      // MANAGED: Google GenAI-compatible route on the platform gateway; the
      // session virtual key authenticates as the API key (x-goog-api-key).
      env.GOOGLE_GEMINI_BASE_URL = `${spec.gateway.baseUrl}/genai`;
      env.GEMINI_API_KEY = spec.gateway.token;
      env.TALE_GATEWAY_TOKEN = spec.gateway.token;
    }
    // BYO: inject NO gateway env — the CLI authenticates with the
    // user-injected session credentials and talks directly to Google.

    // Prompt + system-prompt append + settings travel as ONE JSON object on
    // stdin, never argv: process lists leak argv, and a prompt starting with
    // '-' would parse as a flag. The wrapper reads to EOF, stages the
    // settings + context file, then pipes the prompt into the CLI's stdin
    // (Gemini CLI's native headless prompt source).
    const stdinPayload: Record<string, unknown> = {
      prompt: spec.prompt,
      settings,
    };
    if (spec.systemPromptAppend) {
      // Delivered as a per-exec context file under ~/.gemini/ that the
      // wrapper adds to `context.fileName` alongside GEMINI.md — appended to
      // the model context every turn WITHOUT replacing the CLI's core system
      // prompt (GEMINI_SYSTEM_MD would replace it and drop the defaults).
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
    return new GeminiCliParser();
  }
}
