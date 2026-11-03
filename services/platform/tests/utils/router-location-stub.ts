import { useRef, useSyncExternalStore } from 'react';

/** The part of the router's location a suite stands in. */
export interface StubLocation {
  pathname: string;
  search: Record<string, unknown>;
}

/** Where a suite keeps its location, and how a reader hears it move. */
export interface StubLocationSource {
  readonly current: StubLocation;
  subscribe: (onMove: () => void) => () => void;
}

interface LocationRead {
  select?: (location: StubLocation) => unknown;
  structuralSharing?: boolean;
}

/**
 * A stand-in for the router's `useLocation`, for component suites that mount
 * no RouterProvider. It reads the way the router reads its location store:
 * through `select`, compared by `===`, and with `structuralSharing` an equal
 * selection keeps its earlier reference (`replaceEqualDeep`, the router's
 * own, handed in from the original module). A reader re-renders when what it
 * selects changes, and only then, so a suite can tell a reader that selects
 * from one that takes the whole location:
 *
 * ```ts
 * vi.mock('@tanstack/react-router', async (importOriginal) => {
 *   const router = await importOriginal<typeof import('@tanstack/react-router')>();
 *   const { stubUseLocation } = await import('@/tests/utils/router-location-stub');
 *   return { ...router, useLocation: stubUseLocation(location, router.replaceEqualDeep) };
 * });
 * ```
 *
 * A source whose `subscribe` never calls back moves only on a re-render.
 */
export function stubUseLocation(
  source: StubLocationSource,
  replaceEqualDeep: (previous: unknown, next: unknown) => unknown,
) {
  return function useLocation(read?: LocationRead): unknown {
    const held = useRef<{
      location: StubLocation;
      select: LocationRead['select'];
      selected: unknown;
    } | null>(null);
    // React asks for the snapshot more than once a render: the same location
    // through the same selector answers the same value.
    const snapshot = () => {
      const location = source.current;
      const select = read?.select;
      const last = held.current;
      if (last?.location === location && last.select === select) {
        return last.selected;
      }
      const fresh = select ? select(location) : location;
      const selected = read?.structuralSharing
        ? replaceEqualDeep(last?.selected, fresh)
        : fresh;
      held.current = { location, select, selected };
      return selected;
    };
    return useSyncExternalStore(source.subscribe, snapshot, snapshot);
  };
}
