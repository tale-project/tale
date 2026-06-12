/**
 * Task view-mode plumbing shared by the per-view routes
 * (`routes/…/tasks/board.tsx`, `…/tasks/list.tsx`) and their `/tasks` index
 * redirect. The chosen view persists per project so the bare `/tasks` URL
 * (project tab, notification links) reopens where the user left off.
 */

export type TaskView = 'board' | 'list';

export const TASK_VIEWS: readonly TaskView[] = ['board', 'list'];

export function isTaskView(value: string): value is TaskView {
  return (TASK_VIEWS as readonly string[]).includes(value);
}

/** Same key (and JSON encoding) `usePersistedState` used before the routes
 *  split, so previously stored preferences keep working. */
function storageKey(projectId: string): string {
  return `tale.platform.tasks.${projectId}.view`;
}

export function readPersistedTaskView(projectId: string): TaskView {
  if (typeof window === 'undefined') return 'board';
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return 'board';
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' && isTaskView(parsed) ? parsed : 'board';
  } catch (error) {
    console.warn('[tasks] failed to read persisted view', error);
    return 'board';
  }
}

export function persistTaskView(projectId: string, view: TaskView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(view));
  } catch (error) {
    console.warn('[tasks] failed to persist view', error);
  }
}

/** `?task=<id>` deep-link param shared by every tasks route (board, list,
 *  index redirect) — task URLs stay shareable across the view split. */
export function validateTaskSearch(search: Record<string, unknown>): {
  task?: string;
} {
  const task = search.task;
  return typeof task === 'string' && task.length > 0 ? { task } : {};
}
