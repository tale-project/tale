import {
  clipSummary,
  parseJsonObjects,
  pickNumber,
  pickString,
  isRecord,
  type RuntimeAdapter,
} from './types';

/**
 * OpenCode — `opencode run <prompt> --format json`; resume a session with
 * `-s <id>`. No reliable headless permission flag in v1: safe/auto_edits
 * run with defaults; full_auto is accepted but behaves like defaults
 * (documented limitation — the server-side ceiling still applies).
 */
export const opencodeAdapter: RuntimeAdapter = {
  adapterType: 'opencode',
  binary: 'opencode',
  capabilities: {
    jsonOutput: true,
    sessionResume: true,
    costReporting: false,
    mcp: true,
  },
  buildInvocation({ prompt, permissionMode, resumeSessionRef }) {
    // OpenCode v1 has no headless permission flag, so an elevated request
    // can't actually be honored here — surface that instead of silently
    // dropping it. The server-side ceiling remains the real safety bound.
    if (permissionMode !== 'safe') {
      console.warn(
        `[tale-daemon] opencode adapter ignores permissionMode="${permissionMode}" — no headless permission flag in v1; running with defaults (server ceiling still applies).`,
      );
    }
    const args = ['run', prompt, '--format', 'json'];
    if (resumeSessionRef) args.push('-s', resumeSessionRef);
    return { command: 'opencode', args };
  },
  parseOutput(stdout) {
    const objects = parseJsonObjects(stdout);
    const result = objects.at(-1);
    if (!result) return { summary: clipSummary(stdout) };
    const usage = isRecord(result.usage) ? result.usage : {};
    return {
      summary: clipSummary(
        pickString(result, 'text', 'result', 'message', 'content') ?? stdout,
      ),
      sessionRef: pickString(result, 'session_id', 'sessionID', 'sessionId'),
      inputTokens: pickNumber(usage, 'input_tokens', 'input'),
      outputTokens: pickNumber(usage, 'output_tokens', 'output'),
    };
  },
};
