'use node';

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';

export async function buildTodosPromptAugmentation(
  ctx: ActionCtx,
  threadId: string,
  promptMessage: string,
): Promise<string | undefined> {
  const threadMetadata = await ctx.runQuery(
    internal.threads.internal_queries.getThreadMetadata,
    { threadId },
  );
  const organizationId = threadMetadata?.organizationId;
  if (!organizationId) return undefined;

  const todosRecord = await ctx.runQuery(
    internal.thread_todos.internal_queries.getByThread,
    { organizationId, threadId },
  );
  if (!todosRecord || todosRecord.todos.length === 0) return undefined;

  const formatted = formatTodosForReminder(todosRecord.todos);
  const activeLine = todosRecord.activeTodoId
    ? `Active todo: ${todosRecord.activeTodoId}.`
    : 'No todo is currently in_progress. Pick one or create new todos before acting.';
  const reminder =
    `<system-reminder>\n` +
    `Research plan state (persisted, user-visible):\n` +
    `${formatted}\n` +
    `${activeLine}\n` +
    `Integration calls so far: ${todosRecord.integrationCallCount}.\n` +
    `Continue from the in_progress todo before starting new work. If none is active, mark the next pending one in_progress before searching.\n` +
    `</system-reminder>`;

  return promptMessage ? `${promptMessage}\n\n${reminder}` : reminder;
}

function formatTodosReminderMarker(
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled',
): string {
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

interface TodoSourceLike {
  url: string;
  title?: string;
  score?: number;
  publishedDate?: string;
  capturedAt: number;
}

export function collectUniqueSources(
  todos: Array<{ sources?: TodoSourceLike[] }>,
): Array<{ url: string; title?: string }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; title?: string }> = [];
  for (const todo of todos) {
    for (const src of todo.sources ?? []) {
      if (!src.url || seen.has(src.url)) continue;
      seen.add(src.url);
      out.push({ url: src.url, title: src.title });
    }
  }
  return out;
}

/**
 * Percent-decode URL for display. Many sources are Baidu/CJK URLs with heavy
 * hex-encoded paths — raw they read as noise, decoded they render natural
 * Chinese text. The href stays the original encoded URL so the link resolves.
 */
export function prettifyUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

export function formatTodosForReminder(
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
    findingsSummary?: string;
    failureReason?: string;
  }>,
): string {
  return todos
    .map((todo) => {
      const marker = formatTodosReminderMarker(todo.status);
      const findings = todo.findingsSummary ? ` — ${todo.findingsSummary}` : '';
      const failure =
        todo.status === 'failed' && todo.failureReason
          ? ` (failed: ${todo.failureReason})`
          : '';
      return `${marker} [${todo.id}] ${todo.content}${findings}${failure}`;
    })
    .join('\n');
}
