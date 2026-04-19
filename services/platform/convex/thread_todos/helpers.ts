import type { Infer } from 'convex/values';

import type { todoItemValidator } from './schema';

export type TodoItem = Infer<typeof todoItemValidator>;

export const OP_ID_RING_BUFFER_SIZE = 256;
export const DEFAULT_PER_TODO_SEARCH_CAP = 3;
export const DEFAULT_PER_TODO_EXTRACT_CAP = 2;

/**
 * Derive the active todo id from the todos array. There must be at most one
 * todo in `in_progress` state — the mutation layer enforces this invariant.
 */
export function deriveActiveTodoId(todos: TodoItem[]): string | undefined {
  const active = todos.find((t) => t.status === 'in_progress');
  return active?.id;
}

/**
 * Format todos as a compact markdown checklist suitable for LLM consumption
 * (system-reminder injection, tool return values).
 */
export function formatTodosForPrompt(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return '(no todos yet)';
  }
  const lines: string[] = [];
  for (const t of todos) {
    const marker = todoStatusMarker(t.status);
    const findings = t.findingsSummary ? ` — ${t.findingsSummary}` : '';
    const failure =
      t.status === 'failed' && t.failureReason ? ` (${t.failureReason})` : '';
    lines.push(`${marker} [${t.id}] ${t.content}${findings}${failure}`);
    if (t.sources && t.sources.length > 0) {
      const domains = uniqueDomains(t.sources.map((s) => s.url));
      if (domains.length > 0) {
        lines.push(`    sources: ${domains.join(', ')}`);
      }
    }
  }
  return lines.join('\n');
}

function uniqueDomains(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const domain = extractDomain(url);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function todoStatusMarker(status: TodoItem['status']): string {
  switch (status) {
    case 'done':
      return '[x]';
    case 'in_progress':
      return '[~]';
    case 'failed':
      return '[!]';
    case 'cancelled':
      return '[-]';
    case 'pending':
    default:
      return '[ ]';
  }
}

export function countTodosByStatus(
  todos: TodoItem[],
): Record<TodoItem['status'], number> {
  const counts: Record<TodoItem['status'], number> = {
    pending: 0,
    in_progress: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const t of todos) {
    counts[t.status] = counts[t.status] + 1;
  }
  return counts;
}
