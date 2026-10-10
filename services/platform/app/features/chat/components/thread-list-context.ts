'use client';

/**
 * What every thread row needs from the panel around it — provided once by
 * `ThreadList` so rows render from their own `thread` prop plus this shared
 * frame, instead of threading four identical props through every section.
 *
 * The open thread travels apart from the frame: it changes on every
 * navigation, and a frame that changed with it re-rendered every row of a
 * long list, though only two of them — the one closed, the one opened —
 * change how they look.
 */

import { createContext, useContext } from 'react';

import type { ChatProjectSummary } from '../types';

export interface ThreadListFrame {
  readonly organizationId: string;
  /** The org's projects, for the row menu's "Move to project" submenu. */
  readonly projects: readonly ChatProjectSummary[];
  /** Legal-hold coverage, from ONE bulk read: destructive row actions
   * disable while the org — or the specific thread — is held. */
  readonly orgHeld: boolean;
  readonly heldThreadIds: ReadonlySet<string>;
}

const ThreadListContext = createContext<ThreadListFrame | null>(null);

export const ThreadListFrameProvider = ThreadListContext.Provider;

export function useThreadListFrame(): ThreadListFrame {
  const frame = useContext(ThreadListContext);
  if (!frame) {
    throw new Error('useThreadListFrame requires a ThreadListFrameProvider');
  }
  return frame;
}

const ActiveThreadContext = createContext<string | undefined>(undefined);

/** The thread the page has open, for the rows that mark it themselves. */
export const ActiveThreadProvider = ActiveThreadContext.Provider;

export function useActiveThreadId(): string | undefined {
  return useContext(ActiveThreadContext);
}
