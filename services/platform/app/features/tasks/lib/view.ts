/**
 * Task view-mode plumbing shared by the per-view routes
 * (`routes/…/tasks/board.tsx`, `…/tasks/list.tsx`) and their `/tasks` index
 * their `/tasks` index redirect. The chosen view persists per project so the
 * bare `/tasks` URL (project tab, notification links) reopens where the user
 * left off.
 */

export type TaskView = 'board' | 'list';

export const TASK_VIEWS: readonly TaskView[] = ['board', 'list'];

/** Route path per view — the tab switch and the `/tasks` alias both use it. */
export const TASK_VIEW_ROUTES = {
  board: '/dashboard/$id/projects/$projectId/tasks/board',
  list: '/dashboard/$id/projects/$projectId/tasks/list',
} as const satisfies Record<TaskView, string>;

const TASK_VIEW_SET: ReadonlySet<string> = new Set(TASK_VIEWS);

export function isTaskView(value: string): value is TaskView {
  return TASK_VIEW_SET.has(value);
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
    if (typeof parsed !== 'string') return 'board';
    // The retired backlog tab persisted as `'backlog'` — reopen the board.
    if (parsed === 'backlog') return 'board';
    return isTaskView(parsed) ? parsed : 'board';
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

/** `?task=<id>` deep-link + optional `?projects=all` aggregate scope — shared
 *  by every tasks route (board, list, index redirect). */
export function validateTaskSearch(search: Record<string, unknown>): {
  task?: string;
  projects?: 'all';
} {
  const task =
    typeof search.task === 'string' && search.task.length > 0
      ? search.task
      : undefined;
  const projects = search.projects === 'all' ? ('all' as const) : undefined;
  return {
    ...(task !== undefined ? { task } : {}),
    ...(projects !== undefined ? { projects } : {}),
  };
}

/** True when the Tasks board/list is in the cross-project aggregate scope. */
export function isAllProjectsSearch(search: { projects?: 'all' }): boolean {
  return search.projects === 'all';
}
