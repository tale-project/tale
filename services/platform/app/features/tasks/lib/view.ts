/**
 * Task view-mode plumbing shared by the per-view routes
 * (`routes/…/tasks/board.tsx`, `…/tasks/list.tsx`) and their `/tasks` index
 * their `/tasks` index redirect. The chosen view persists per project so the
 * bare `/tasks` URL (project tab, notification links) reopens where the user
 * left off.
 */

export type TaskView = 'board' | 'list';

const TASK_VIEWS: readonly TaskView[] = ['board', 'list'];

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

/**
 * The history state an open pushes: how many sheet entries sit above the
 * bare board, so a close can walk back over the whole chain (task → subtask
 * → …) instead of leaving dead entries behind.
 */
export interface TaskSheetHistoryState {
  taskSheetDepth?: number;
}

/**
 * The `navigate()` options that open the `?task=` detail sheet. Opening a
 * task — or stepping from a task into its subtask — PUSHES a history entry,
 * so browser Back returns to the previous task or to the bare board instead
 * of leaving the page; the entry remembers its depth in the chain.
 */
export function openTaskNavigation(
  taskId: string,
  current: TaskSheetHistoryState | undefined,
): {
  search: <S extends { task?: string }>(prev: S) => S;
  replace: false;
  state: TaskSheetHistoryState;
} {
  return {
    search: (prev) => ({ ...prev, task: taskId }),
    replace: false,
    state: { taskSheetDepth: (current?.taskSheetDepth ?? 0) + 1 },
  };
}

/**
 * The `navigate()` options that close the sheet when it was reached by a
 * deep link (nothing pushed): REPLACE the entry, so Back/Forward never
 * resurrects a dialog the reader already dismissed.
 */
export function closeTaskNavigation(): {
  search: <S extends { task?: string }>(prev: S) => S;
  replace: true;
} {
  return {
    search: (prev) => {
      const next = { ...prev };
      delete next.task;
      return next;
    },
    replace: true,
  };
}

/**
 * How many entries back the bare board sits — the sheet chain's depth,
 * capped by what the history actually holds — or `0` when the sheet was
 * opened by a deep link (nothing pushed).
 */
export function taskSheetBackSteps(location: {
  state: TaskSheetHistoryState & { __TSR_index?: number };
}): number {
  const depth = location.state.taskSheetDepth ?? 0;
  const index = location.state.__TSR_index ?? 0;
  if (!Number.isInteger(depth) || depth <= 0) return 0;
  return Math.max(0, Math.min(depth, index));
}

/**
 * Close the sheet. When the open pushed (the common case) the close walks
 * back over the chain, so the history is what it was before the open — no
 * dead `board → board` entry Back has to step over; a deep-linked sheet
 * (nothing to walk back to) replaces its entry instead.
 */
export function dismissTaskSheet(
  history: {
    location: { state: TaskSheetHistoryState & { __TSR_index?: number } };
    go: (index: number) => void;
  },
  navigate: (options: ReturnType<typeof closeTaskNavigation>) => unknown,
): void {
  const steps = taskSheetBackSteps(history.location);
  if (steps > 0) {
    history.go(-steps);
    return;
  }
  void navigate(closeTaskNavigation());
}
