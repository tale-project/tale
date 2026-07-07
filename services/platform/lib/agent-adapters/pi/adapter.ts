// Pi adapter — headless `pi --mode json` driven through the `tale-pi-run`
// wrapper. Managed runs route model calls through the platform LLM gateway's
// OpenAI-compatible route via a per-exec Pi custom provider ("tale-gateway"
// in a staged models.json, baseUrl = <gateway>/openai/v1, apiKey =
// "$TALE_GATEWAY_TOKEN" env interpolation — the staged file never contains
// the key); BYO injects no gateway config and Pi's own env inference picks
// the user's session credentials (OPENROUTER_API_KEY, ANTHROPIC_API_KEY,
// OPENAI_API_KEY, GEMINI_API_KEY, …).
//
// Everything here is verified against the pinned
// @earendil-works/pi-coding-agent 0.80.3 (flags, models.json schema,
// APPEND_SYSTEM.md discovery, session resume — see the wrapper's header for
// the full mechanism notes) plus real captured runs against a mock gateway.

import type { AgentEventParser } from '../events';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunSpec,
  CredentialPolicy,
  SessionExecSpec,
} from '../types';
import { PiParser } from './parse';

/** Session-relative Pi user-skills dir under HOME (/user/.runtime/home).
 * Verified 0.80.3: ~/.agents/skills is an always-trusted GLOBAL skills
 * location (trust-manager.ts + package-manager.ts), homedir-based — so it
 * survives the wrapper's per-exec PI_CODING_AGENT_DIR override. */
const PI_SKILLS_STAGE_DIR = '.runtime/home/.agents/skills' as const;

const CREDENTIAL_POLICY: CredentialPolicy = {
  managedSource: 'gateway',
  // BYO Pi commonly talks to an OpenRouter-style backend (OPENROUTER_API_KEY),
  // and Pi's built-in openrouter catalog speaks the Tale catalog's
  // vendor-prefixed ids verbatim (`anthropic/claude-sonnet-4.6` is a literal
  // model id in openrouter.models.ts at v0.80.3) — the Anthropic-native
  // translation would resolve to a DIFFERENT provider entry.
  byoModelIdSource: 'catalog',
  supportsByo: true,
  supportsManaged: true,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'one-shot',
  promptTransport: 'stdin-ndjson',
  // Per-exec config (models.json / settings.json / APPEND_SYSTEM.md) rides
  // the stdin payload and is staged to disk by the wrapper before the CLI
  // starts. Pi has NO MCP support at all (0.80.3 README: "No MCP") — this
  // only describes how its own config lands.
  mcpDelivery: 'staged-file',
  supportsPlanMode: false,
  supportsMidTurnSteering: false,
  // Pi's tools are not cwd-scoped (bash/read/write reach any session path),
  // so attachment dirs like /user/uploads need no grant — nothing to wire.
  supportsAttachmentDirs: true,
  // No MCP → no integration-dispatch bridge and no Playwright browser server.
  supportsIntegrationsBridge: false,
  supportsVisionPolyfill: false,
  skillsStageDir: PI_SKILLS_STAGE_DIR,
};

const CREDENTIAL_ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'TALE_GATEWAY_TOKEN',
] as const;

/** The staged models.json provider name managed runs pin via --provider. */
const GATEWAY_PROVIDER = 'tale-gateway';

export class PiAdapter implements AgentAdapter {
  readonly slug = 'pi' as const;
  readonly credentialPolicy = CREDENTIAL_POLICY;
  readonly capabilities = CAPABILITIES;
  readonly credentialEnvKeys = CREDENTIAL_ENV_KEYS;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    const byo = spec.authMode === 'byo';
    const argv = ['tale-pi-run', '--workdir', spec.workdir];
    if (spec.agentSessionId) argv.push('--resume', spec.agentSessionId);
    // Managed: pin the staged gateway provider so model resolution never
    // wanders into Pi's built-in catalog (its default provider is google).
    // BYO: the catalog id (or raw user-typed id) resolves against Pi's own
    // registry with the user's credentials.
    // `spec.fallbackModel` is deliberately ignored: Pi has no
    // availability-fallback chain — the turn runs entirely on the selected
    // model. `spec.maxTurns` too: Pi 0.80.3 has no turn-cap flag.
    if (!byo && spec.model && spec.gateway) {
      argv.push('--provider', GATEWAY_PROVIDER);
    }
    if (spec.model) argv.push('--model', spec.model);
    // Pi has NO native web tools (built-in tools: read, bash, edit, write,
    // grep, find, ls — verified 0.80.3) and no interactive-question tool, so
    // there is nothing to deny for managed/headless runs and
    // `spec.nativeWebTools` has nothing to lift. `spec.additionalDirs` needs
    // no wiring either — Pi's file tools are not cwd-scoped.

    const env: Record<string, string> = {};
    // Prompt + system-prompt append + per-exec config travel as ONE JSON
    // object on stdin, never argv: process lists leak argv, and a prompt
    // starting with '-' would parse as a flag. The wrapper stages the config
    // files into a private per-exec PI_CODING_AGENT_DIR, then pipes the
    // prompt into the CLI's stdin (Pi's native headless prompt source).
    const stdinPayload: Record<string, unknown> = {
      prompt: spec.prompt,
      // Staged as <agentDir>/settings.json. Default-on install telemetry
      // pings home; a sandbox turn must not.
      settings: { enableInstallTelemetry: false },
    };
    if (spec.systemPromptAppend) {
      // Staged as <agentDir>/APPEND_SYSTEM.md — auto-discovered when no
      // --append-system-prompt flag is given (verified 0.80.3
      // resource-loader) and APPENDED to Pi's default system prompt without
      // replacing it (SYSTEM.md would replace it and drop the defaults).
      stdinPayload.system_prompt = spec.systemPromptAppend;
    }
    if (!byo && spec.gateway) {
      // MANAGED: OpenAI-compatible route on the platform gateway, wired as a
      // Pi custom provider. The session key rides `$TALE_GATEWAY_TOKEN` env
      // interpolation (verified 0.80.3 models.json value resolution), never
      // the staged JSON itself (the staged file may get logged).
      stdinPayload.models = {
        providers: {
          [GATEWAY_PROVIDER]: {
            baseUrl: `${spec.gateway.baseUrl}/openai/v1`,
            api: 'openai-completions',
            apiKey: '$TALE_GATEWAY_TOKEN',
            ...(spec.model && { models: [{ id: spec.model }] }),
          },
        },
      };
      env.TALE_GATEWAY_TOKEN = spec.gateway.token;
    }
    // BYO: inject NO gateway env — the CLI authenticates with the
    // user-injected session credentials and talks to the provider directly.

    return {
      argv,
      env,
      cwd: spec.workdir,
      stdin: JSON.stringify(stdinPayload),
      stdinMode: 'close',
    };
  }

  createParser(): AgentEventParser {
    return new PiParser();
  }
}
