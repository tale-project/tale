/**
 * Pure decision + prompt for token-source rotation on a RESUMED durable sandbox
 * segment. Isolated here (mirrors `summary_reentry.ts` / `agent_run_outcome.ts`)
 * so the gating logic is unit-testable without importing the node-only run
 * module. The orchestration — re-fetching bindings, building the pool, and the
 * rotation loop — lives in `workflow_sandbox_exec`.
 */

/**
 * Continuation prompt for the fresh `claude --resume <id>` exec spawned to swap
 * the credential mid-task after the re-attached segment died on a rotatable API
 * error. It must NOT restart the task — it continues the SAME conversation on a
 * healthy token — and must keep the mandated handoff in view so the rotated
 * attempt still produces `output/summary.md`.
 */
export const RESUME_CONTINUATION_PROMPT = [
  'Your previous attempt stopped on an API error and has been resumed on a',
  'fresh credential. CONTINUE the task from where you left off — do NOT restart',
  'it or repeat completed work. When you finish, write the mandated handoff file',
  'at the ABSOLUTE path /agent/output/summary.md covering (1) what you did, (2)',
  'every file you produced (path + purpose), (3) the final result/state, and (4)',
  'what is next. Then stop.',
].join('\n');

/**
 * Whether to attempt non-destructive token rotation on a resumed segment. All
 * three preconditions are required:
 *  - `resuming` — this segment re-attached to a handed-off conversation;
 *  - `agentSessionId` — the Claude session id is known, so a `--resume` exec can
 *    be spawned on the fresh credential;
 *  - `tokenPoolPresent` — a broker token pool was resolved to rotate within.
 * Absent any of them, the only recovery for a rotatable error is Part A's
 * destructive fresh-step retry.
 */
export function shouldAttemptResumeRotation(input: {
  resuming: boolean;
  agentSessionId: string | undefined;
  tokenPoolPresent: boolean;
}): boolean {
  return (
    input.resuming &&
    input.agentSessionId !== undefined &&
    input.tokenPoolPresent
  );
}
