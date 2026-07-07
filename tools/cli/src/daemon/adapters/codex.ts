import {
  clipSummary,
  parseJsonObjects,
  pickNumber,
  pickString,
  isRecord,
  type RuntimeAdapter,
} from './types';

/**
 * OpenAI Codex CLI — `codex exec --json <prompt>` emits JSONL events; usage
 * arrives on the `turn.completed` event (tokens only, no dollars). Resume:
 * `codex exec resume <id>`. The sandbox flag maps 1:1 onto the permission
 * ceiling: read-only / workspace-write / danger-full-access.
 *
 * ARGV/PARSE QUIRKS SOURCE OF TRUTH: the platform sandbox adapter
 * (services/platform/lib/agent-adapters/codex/) — its adapter.ts/parse.ts
 * document the verified CLI contract per pinned version (stdin `-` prompt
 * sentinel, resume subcommand flag surface, `-c` override keys, --json event
 * schema). Keep any invocation/parse change here in sync with it.
 */
export const codexAdapter: RuntimeAdapter = {
  adapterType: 'codex',
  binary: 'codex',
  capabilities: {
    jsonOutput: true,
    sessionResume: true,
    costReporting: false,
    mcp: true,
  },
  buildInvocation({ prompt, permissionMode, resumeSessionRef }) {
    const sandbox =
      permissionMode === 'full_auto'
        ? 'danger-full-access'
        : permissionMode === 'auto_edits'
          ? 'workspace-write'
          : 'read-only';
    const args = resumeSessionRef
      ? [
          'exec',
          'resume',
          resumeSessionRef,
          '--json',
          '--sandbox',
          sandbox,
          prompt,
        ]
      : ['exec', '--json', '--sandbox', sandbox, prompt];
    return { command: 'codex', args };
  },
  parseOutput(stdout) {
    const objects = parseJsonObjects(stdout);
    let summary: string | undefined;
    let sessionRef: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for (const event of objects) {
      sessionRef =
        pickString(event, 'session_id', 'thread_id', 'conversation_id') ??
        sessionRef;
      const message = isRecord(event.msg) ? event.msg : event;
      const text = pickString(message, 'last_agent_message', 'message', 'text');
      if (text) summary = text;
      const usage = isRecord(message.usage)
        ? message.usage
        : isRecord(event.usage)
          ? event.usage
          : undefined;
      if (usage) {
        inputTokens = pickNumber(usage, 'input_tokens') ?? inputTokens;
        outputTokens = pickNumber(usage, 'output_tokens') ?? outputTokens;
      }
    }
    return {
      summary: clipSummary(summary ?? stdout),
      sessionRef,
      inputTokens,
      outputTokens,
    };
  },
};
