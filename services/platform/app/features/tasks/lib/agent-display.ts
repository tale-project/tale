/**
 * Task-side remnant of the retired agent taxonomy. The full classifier lived
 * with the agents backend, which is offline while it is rebuilt; tasks keep
 * only what their own UI still needs — the category/hint types that shape
 * `AssignableAgent`, and the pure code-task heuristic behind the
 * coding-agent guidance in the assignee picker. Re-unify with the agents
 * taxonomy when the rebuilt backend ships it again.
 */

export type AgentDisplayCategory = 'agent' | 'coding-agent' | 'image-agent';

export type TaskDispatchHintKey =
  | 'agent-platform'
  | 'coding-daemon'
  | 'coding-durable'
  | 'coding-sandbox-only';

const CODE_TASK_LABELS = new Set([
  'bug',
  'chore',
  'epic',
  'feature',
  'fix',
  'refactor',
  'spike',
  'tech-debt',
]);

const CODE_TASK_KEYWORDS =
  /\b(bug|fix|implement|refactor|repo|repository|pull request|\bpr\b|test suite|unit test|integration test|code review|deploy|build|compile|typescript|javascript|python|api endpoint|migration)\b/i;

/**
 * Best-effort heuristic for assignee-picker guidance — not authoritative routing.
 */
export function looksLikeCodeTask(task: {
  title?: string;
  description?: string;
  labels?: string[];
}): boolean {
  if (task.labels?.some((label) => CODE_TASK_LABELS.has(label.toLowerCase()))) {
    return true;
  }
  const blob = `${task.title ?? ''}\n${task.description ?? ''}`.trim();
  if (!blob) return false;
  return CODE_TASK_KEYWORDS.test(blob);
}
