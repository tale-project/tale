// Hermes Agent adapter — headless `tale-hermes-run` with NDJSON stdout.
// Managed runs route model calls through the platform LLM gateway via
// OPENAI_BASE_URL + OPENAI_API_KEY; BYO uses credentials injected into the
// session env (OpenRouter, Anthropic, OpenAI, …).

import type { AgentEventParser } from '../events';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunSpec,
  CredentialPolicy,
  SessionExecSpec,
} from '../types';
import { DEFAULT_MAX_TURNS } from '../types';
import { HermesParser } from './parse';

/** Session-relative Hermes profile root under HOME (/user/.runtime/home). */
const HERMES_SKILLS_STAGE_DIR = '.runtime/home/.hermes/skills' as const;

const CREDENTIAL_POLICY: CredentialPolicy = {
  managedSource: 'gateway',
  // BYO Hermes talks to an OpenRouter-style backend (OPENROUTER_API_KEY), which
  // speaks the catalog's vendor-prefixed ids (`anthropic/claude-sonnet-4.6`) —
  // the Anthropic-native translation (`claude-sonnet-4-6`) is rejected there.
  byoModelIdSource: 'catalog',
  supportsByo: true,
  supportsManaged: true,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'one-shot',
  promptTransport: 'stdin-ndjson',
  mcpDelivery: 'inline-env',
  supportsPlanMode: false,
  supportsMidTurnSteering: false,
  supportsAttachmentDirs: true,
  supportsIntegrationsBridge: false,
  supportsVisionPolyfill: false,
  skillsStageDir: HERMES_SKILLS_STAGE_DIR,
};

const CREDENTIAL_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'TALE_GATEWAY_TOKEN',
] as const;

export class HermesAdapter implements AgentAdapter {
  readonly slug = 'hermes' as const;
  readonly credentialPolicy = CREDENTIAL_POLICY;
  readonly capabilities = CAPABILITIES;
  readonly credentialEnvKeys = CREDENTIAL_ENV_KEYS;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    const byo = spec.authMode === 'byo';
    const argv = [
      'tale-hermes-run',
      '--workdir',
      spec.workdir,
      '--max-turns',
      String(spec.maxTurns ?? DEFAULT_MAX_TURNS),
    ];

    if (spec.agentSessionId) {
      argv.push('--resume', spec.agentSessionId);
    }
    if (spec.model) {
      argv.push('--model', spec.model);
    }

    const env: Record<string, string> = {
      HERMES_HOME: '/user/.runtime/home/.hermes',
      HERMES_ACCEPT_HOOKS: '1',
      HERMES_YOLO_MODE: '1',
    };

    if (!byo && spec.gateway) {
      env.OPENAI_BASE_URL = `${spec.gateway.baseUrl}/openai/v1`;
      env.OPENAI_API_KEY = spec.gateway.token;
      env.TALE_GATEWAY_TOKEN = spec.gateway.token;
    }

    // Prompt + system prompt travel as ONE JSON object on stdin, never argv:
    // process lists leak argv, and a prompt starting with '-' would parse as
    // a flag (tale-hermes-run is argparse-based). Close-mode stdin writes the
    // payload and EOFs — the wrapper reads to EOF before starting the run.
    const stdinPayload: Record<string, string> = { prompt: spec.prompt };
    if (spec.systemPromptAppend) {
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
    return new HermesParser();
  }
}
