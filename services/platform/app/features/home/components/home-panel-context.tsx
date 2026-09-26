'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { usePersistedState } from '@/app/hooks/use-persisted-state';

interface HomePanelState {
  /** A Home frame is present — something can be shown or hidden. */
  readonly available: boolean;
  /** The panel element is on screen right now (a toggle may name it with
   * `aria-controls` only then). */
  readonly mounted: boolean;
  readonly setMounted: (mounted: boolean) => void;
  /** The desktop panel is showing. */
  readonly open: boolean;
  readonly setOpen: (open: boolean | ((previous: boolean) => boolean)) => void;
}

const HomePanelContext = createContext<HomePanelState | null>(null);

/**
 * Whether the Home panel shows on desktop. Org-scoped, NOT user-scoped, on
 * purpose: the pre-hydration script in index.html reads this exact key before
 * auth (or any bundle) runs to decide whether the served boot shell holds the
 * panel's slot — it cannot know the user id. Panel visibility is layout
 * chrome, device-scoped like the theme.
 */
export function HomePanelProvider({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistedState(
    `chat-history-panel-open-${organizationId}`,
    true,
  );
  const [mounted, setMounted] = useState(false);
  const value = useMemo(
    () => ({ available: true, mounted, setMounted, open, setOpen }),
    [mounted, open, setOpen],
  );
  return (
    <HomePanelContext.Provider value={value}>
      {children}
    </HomePanelContext.Provider>
  );
}

/** The panel's visibility; a fixed open state outside the provider (tests,
 * standalone renders), so consumers never need a guard. */
export function useHomePanel(): HomePanelState {
  const context = useContext(HomePanelContext);
  return context ?? ALWAYS_OPEN;
}

const ALWAYS_OPEN: HomePanelState = {
  available: false,
  mounted: false,
  setMounted: () => undefined,
  open: true,
  setOpen: () => undefined,
};
