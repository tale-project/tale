import { useCallback, useState } from 'react';

type BusyAction = 'start' | 'rotate';

/**
 * Which sessions have a request of this tab under way (a start, a rotation),
 * so that their controls say so. Counted, because a session can be asked twice.
 */
export function useBusySessions() {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  const track = useCallback(
    async <T>(
      sessionId: number,
      action: BusyAction,
      request: Promise<T>,
    ): Promise<T> => {
      const key = `${action}:${sessionId}`;
      const change = (by: number) =>
        setCounts((current) =>
          new Map(current).set(key, (current.get(key) ?? 0) + by),
        );
      change(1);
      try {
        return await request;
      } finally {
        change(-1);
      }
    },
    [],
  );

  const isBusy = useCallback(
    (action: BusyAction, sessionId: number) =>
      (counts.get(`${action}:${sessionId}`) ?? 0) > 0,
    [counts],
  );

  return { track, isBusy };
}
