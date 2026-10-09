import { useCallback, useMemo } from 'react';

import { usePersistedState } from '@/app/hooks/use-persisted-state';

import type { TaskStatus } from '../lib/display';

/** The lanes a board can fold to a rail: where finished work piles up. */
const COLLAPSIBLE_LANES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'done',
  'cancelled',
]);

export function isCollapsibleLane(status: TaskStatus): boolean {
  return COLLAPSIBLE_LANES.has(status);
}

/**
 * Which of a board's lanes are folded, remembered in this browser per board
 * (`scope`: a project's id, or `all` for the all-projects board), so a
 * board opens the way it was left.
 */
export function useCollapsedLanes(scope: string) {
  const [stored, setStored] = usePersistedState<string[]>(
    `tale.platform.tasks.board.collapsedLanes.${scope}`,
    [],
  );
  const collapsed = useMemo(
    () =>
      new Set(
        stored.filter((status): status is TaskStatus =>
          COLLAPSIBLE_LANES.has(status as TaskStatus),
        ),
      ) as ReadonlySet<TaskStatus>,
    [stored],
  );
  const setCollapsed = useCallback(
    (status: TaskStatus, fold: boolean) => {
      if (!COLLAPSIBLE_LANES.has(status)) return;
      setStored((previous) =>
        fold
          ? previous.includes(status)
            ? previous
            : [...previous, status]
          : previous.filter((entry) => entry !== status),
      );
    },
    [setStored],
  );
  return { collapsed, setCollapsed };
}
