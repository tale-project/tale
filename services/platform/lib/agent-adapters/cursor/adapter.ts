// Cursor Agent CLI adapter — headless `agent -p` with stream-json stdout.
// Credentials (CURSOR_API_KEY) are injected by the platform; this module only
// builds argv/env.

import type { AgentEventParser } from '../events';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunSpec,
  CredentialPolicy,
  SessionExecSpec,
} from '../types';
import { CursorParser } from './parse';

const CREDENTIAL_POLICY: CredentialPolicy = {
  managedSource: 'agent-env',
  supportsByo: true,
  // The Cursor CLI takes only --api-key / CURSOR_API_KEY and has no
  // OpenAI-compatible base-URL override, so it cannot route through the platform
  // gateway. Cursor is BYO only.
  supportsManaged: false,
};

const CAPABILITIES: AgentCapabilities = {
  processLifecycle: 'one-shot',
  promptTransport: 'argv-positional',
  mcpDelivery: 'staged-file',
  supportsPlanMode: false,
  supportsMidTurnSteering: false,
  supportsAttachmentDirs: false,
  supportsIntegrationsBridge: false,
  supportsVisionPolyfill: false,
};

const CREDENTIAL_ENV_KEYS = ['CURSOR_API_KEY'] as const;

export class CursorAdapter implements AgentAdapter {
  readonly slug = 'cursor' as const;
  readonly credentialPolicy = CREDENTIAL_POLICY;
  readonly capabilities = CAPABILITIES;
  readonly credentialEnvKeys = CREDENTIAL_ENV_KEYS;

  buildExec(spec: AgentRunSpec): SessionExecSpec {
    // NO --max-turns: the pinned CLI (2026.03.20) has no such option, and an
    // unknown flag makes `agent -p` exit 1 SILENTLY (no stdout/stderr) —
    // verified in-sandbox. `spec.maxTurns` is deliberately ignored; runaway
    // protection is the platform's exec timeout + action deadline.
    const argv = [
      'agent',
      '-p',
      '--force',
      '--trust',
      '--sandbox',
      'disabled',
      '--output-format',
      'stream-json',
      '--workspace',
      spec.workdir,
    ];

    if (spec.agentSessionId) {
      argv.push('--resume', spec.agentSessionId);
    }

    if (spec.model && spec.model !== 'default') {
      argv.push('--model', spec.model);
    }

    // Prompt is argv positional — Cursor CLI has no stdin prompt transport.
    argv.push(spec.prompt);

    return { argv, env: {}, cwd: spec.workdir, stdinMode: 'close' };
  }

  createParser(): AgentEventParser {
    return new CursorParser();
  }
}
