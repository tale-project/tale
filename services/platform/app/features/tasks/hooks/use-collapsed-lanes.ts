import { useCallback, useMemo } from 'react';

import { usePersistedState } from '@/app/hooks/use-persisted-state';

import type { TaskStatus } from '../lib/display';

/** The lanes a board can fold to a rail: where finished work piles up. */
const COLLAPSIBLE_LANES: ReadonlySet<string> = new Set<TaskStatus>([
  'done',
  'cancelled',
]);

export function isCollapsibleLane(status: string): status is TaskStatus {
  return COLLAPSIBLE_LANES.has(status);
}

/** Stored preferences are untrusted, including entries in an otherwise valid array. */
function readCollapsedLanes(value: unknown): TaskStatus[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry: unknown): entry is TaskStatus =>
      typeof entry === 'string' && isCollapsibleLane(entry),
  );
}

/**
 * Which of a board's lanes are folded, remembered in this browser per board
 * (`scope`: a project's id, or `all` for the all-projects board), so a
 * board opens the way it was left.
 */
export function useCollapsedLanes(scope: string) {
  const [stored, setStored] = usePersistedState<unknown>(
    `tale.platform.tasks.board.collapsedLanes.${scope}`,
    [],
  );
  const collapsed = useMemo(
    (): ReadonlySet<TaskStatus> => new Set(readCollapsedLanes(stored)),
    [stored],
  );
  const setCollapsed = useCallback(
    (status: TaskStatus, fold: boolean) => {
      if (!COLLAPSIBLE_LANES.has(status)) return;
      setStored((previous: unknown) => {
        const lanes = readCollapsedLanes(previous);
        return fold
          ? lanes.includes(status)
            ? lanes
            : [...lanes, status]
          : lanes.filter((entry) => entry !== status);
      });
    },
    [setStored],
  );
  return { collapsed, setCollapsed };
}
