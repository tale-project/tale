/**
 * Adapter contract: one module per coding-agent CLI. Adapters only BUILD
 * the invocation and PARSE its output — spawning, timeouts, cancellation,
 * and the git worktree are owned by the daemon loop, so every adapter gets
 * identical lifecycle behavior.
 *
 * Output parsing is deliberately defensive: CLI JSON shapes drift between
 * versions, so parsers try the known fields and fall back to raw stdout as
 * the summary rather than failing the run. `detect()` records the CLI
 * version so the server can feature-gate on it.
 */

export type PermissionMode = 'safe' | 'auto_edits' | 'full_auto';

export interface AdapterCapabilities {
  jsonOutput: boolean;
  sessionResume: boolean;
  costReporting: boolean;
  mcp: boolean;
}

export interface AdapterDetection {
  adapterType: string;
  version?: string;
  capabilities: AdapterCapabilities;
}

export interface RunInvocation {
  command: string;
  args: string[];
  /** Extra environment for the child (merged over process.env). */
  env?: Record<string, string>;
}

export interface RunOutcome {
  summary: string;
  sessionRef?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Only Claude Code reports real dollars; others stay undefined. */
  costCents?: number;
}

export interface RuntimeAdapter {
  adapterType: string;
  /** CLI binary to probe with `--version`. */
  binary: string;
  capabilities: AdapterCapabilities;
  buildInvocation(req: {
    prompt: string;
    permissionMode: PermissionMode;
    resumeSessionRef?: string;
  }): RunInvocation;
  parseOutput(stdout: string): RunOutcome;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function pickString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function pickNumber(
  record: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Last JSON object in possibly-JSONL stdout (Codex emits event lines). */
export function parseJsonObjects(stdout: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) objects.push(parsed);
    } catch {
      // Not a complete JSON line (mixed prose output) — skip it; the
      // defensive parsers fall back to raw stdout when nothing parses.
      continue;
    }
  }
  if (objects.length === 0) {
    try {
      const whole: unknown = JSON.parse(stdout.trim());
      if (isRecord(whole)) objects.push(whole);
    } catch {
      // Whole-output parse failed too — callers fall back to raw stdout.
    }
  }
  return objects;
}

/** Clip a summary to a sane report size. */
export function clipSummary(text: string, max = 8_000): string {
  const trimmed = text.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max)}\n…(clipped)`
    : trimmed;
}
