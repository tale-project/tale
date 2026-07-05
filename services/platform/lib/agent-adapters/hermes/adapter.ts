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
export const HERMES_SKILLS_STAGE_DIR = '.runtime/home/.hermes/skills' as const;

const CREDENTIAL_POLICY: CredentialPolicy = {
  managedSource: 'gateway',
  supportsByo: true,
  supportsManaged: true,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'one-shot',
  promptTransport: 'argv-positional',
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
      '--prompt',
      spec.prompt,
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
    if (spec.systemPromptAppend) {
      argv.push('--system-prompt', spec.systemPromptAppend);
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

    return { argv, env, cwd: spec.workdir, stdinMode: 'close' };
  }

  createParser(): AgentEventParser {
    return new HermesParser();
  }
}
