import {
  clipSummary,
  parseJsonObjects,
  pickNumber,
  pickString,
  isRecord,
  type RuntimeAdapter,
} from './types';

/**
 * Claude Code (`claude`) — the only CLI that reports real dollar cost
 * (`total_cost_usd`). Headless: `claude -p <prompt> --output-format json`;
 * resume via `--resume <session_id>`. Permission ceiling mapping:
 * safe → default prompts denied-by-default, auto_edits → acceptEdits,
 * full_auto → --dangerously-skip-permissions (double opt-in: only when
 * BOTH the server config and the daemon allow it).
 */
export const claudeCodeAdapter: RuntimeAdapter = {
  adapterType: 'claude_code',
  binary: 'claude',
  capabilities: {
    jsonOutput: true,
    sessionResume: true,
    costReporting: true,
    mcp: true,
  },
  buildInvocation({ prompt, permissionMode, resumeSessionRef }) {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (resumeSessionRef) args.push('--resume', resumeSessionRef);
    if (permissionMode === 'auto_edits') {
      args.push('--permission-mode', 'acceptEdits');
    } else if (permissionMode === 'full_auto') {
      args.push('--dangerously-skip-permissions');
    }
    return { command: 'claude', args };
  },
  parseOutput(stdout) {
    const objects = parseJsonObjects(stdout);
    const result = objects.at(-1);
    if (!result) return { summary: clipSummary(stdout) };
    const usage = isRecord(result.usage) ? result.usage : {};
    const costUsd = pickNumber(result, 'total_cost_usd', 'cost_usd');
    return {
      summary: clipSummary(
        pickString(result, 'result', 'text', 'content') ?? stdout,
      ),
      sessionRef: pickString(result, 'session_id', 'sessionId'),
      inputTokens: pickNumber(usage, 'input_tokens', 'inputTokens'),
      outputTokens: pickNumber(usage, 'output_tokens', 'outputTokens'),
      costCents: costUsd !== undefined ? Math.round(costUsd * 100) : undefined,
    };
  },
};
