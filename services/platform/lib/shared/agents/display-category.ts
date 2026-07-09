/**
 * Product-facing agent taxonomy for UI — derived from existing agent JSON fields.
 * Does not change dispatch behavior; see `run_agent_on_task.ts` for execution paths.
 */

export type AgentDisplayCategory = 'agent' | 'coding-agent' | 'image-agent';

export type TaskDispatchHintKey =
  | 'agent-platform'
  | 'coding-daemon'
  | 'coding-durable'
  | 'coding-sandbox-only';

export interface AgentDisplayCategoryInput {
  primaryBehavior?: string;
  /** Server-config shape: the raw `runtime` binding (tale-daemon). */
  runtime?: unknown;
  /** UI wire shape: `listAgents` and the FE adapters expose `hasRuntime`, not `runtime`. */
  hasRuntime?: boolean;
  preferDurableStepForTasks?: boolean;
}

/** True when the agent binds a task runtime (tale-daemon) — via either shape. */
function isRuntimeBound(config: AgentDisplayCategoryInput): boolean {
  return config.runtime !== undefined || config.hasRuntime === true;
}

export function getAgentDisplayCategory(
  config: AgentDisplayCategoryInput,
): AgentDisplayCategory {
  if (config.primaryBehavior === 'image-generation') {
    return 'image-agent';
  }
  if (
    config.primaryBehavior === 'external-agent' ||
    isRuntimeBound(config) ||
    config.preferDurableStepForTasks === true
  ) {
    return 'coding-agent';
  }
  return 'agent';
}

/** Returns a stable i18n key suffix under `*.dispatchHints.*` or `taskBoard.*`. */
export function getTaskDispatchHintKey(
  config: AgentDisplayCategoryInput,
): TaskDispatchHintKey | null {
  const category = getAgentDisplayCategory(config);
  if (category === 'image-agent') return null;
  if (category === 'agent') return 'agent-platform';
  if (isRuntimeBound(config)) return 'coding-daemon';
  if (config.preferDurableStepForTasks === true) return 'coding-durable';
  return 'coding-sandbox-only';
}

/** Suffix for `tasks.assignee.dispatchHints.*` and `settings.agents.form.taskBoard.*`. */
export function taskDispatchHintI18nSuffix(
  key: TaskDispatchHintKey,
): 'agentPlatform' | 'codingDaemon' | 'codingDurable' | 'codingSandboxOnly' {
  switch (key) {
    case 'agent-platform':
      return 'agentPlatform';
    case 'coding-daemon':
      return 'codingDaemon';
    case 'coding-durable':
      return 'codingDurable';
    case 'coding-sandbox-only':
      return 'codingSandboxOnly';
  }
}

/** Suffix for `settings.agents.form.displayCategory.*` and catalog badges. */
export function displayCategoryI18nSuffix(
  category: AgentDisplayCategory,
): 'agent' | 'codingAgent' | 'imageAgent' {
  switch (category) {
    case 'agent':
      return 'agent';
    case 'coding-agent':
      return 'codingAgent';
    case 'image-agent':
      return 'imageAgent';
  }
}

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
