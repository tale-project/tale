/**
 * Task-side agent display taxonomy: the category that shapes
 * `AssignableAgent` (project-agent instances are `coding-agent` — they run on
 * coding harnesses in a sandbox), and the pure code-task heuristic behind the
 * coding-agent guidance in the assignee picker.
 */

export type AgentDisplayCategory = 'agent' | 'coding-agent' | 'image-agent';

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
