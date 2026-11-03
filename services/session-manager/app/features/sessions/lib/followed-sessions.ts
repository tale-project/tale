import { QueryObserver, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/app/lib/api/client';
import { sessionsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { POLL_FAST_MS, sessionIsBusy } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';

import type { FinishedWork, FollowedWork } from './proxy-flows';
import { removalOf, sessionGone } from './removal';

/**
 * Whether a dialog of the page is open (the flows' own dialogs included). A
 * dialog is modal: one that nobody asked for just now must not be put on top
 * of it, or push the person's own aside.
 */
function aDialogIsOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  );
}

/**
 * How long work that is over waits for the work of other sessions that ends
 * with it: the reads of two sessions come a moment apart, and the person is
 * asked once for the both of them, not twice.
 */
export const GATHER_MS = 250;

interface Entry {
  work: FollowedWork;
  /** What has been read of the session so far. */
  read: () => { data: Session | undefined; error: unknown };
  unsubscribe: () => void;
}

/**
 * The sessions this tab made the server start background work for (a proxy to
 * assign, a browser to launch), looked at until that work is over: then they
 * are handed to the listener, those that end together together.
 *
 * Only what is read after the work began counts. Every call to `follow` reads
 * the session anew, under a key of its own, so that nothing a page knew before
 * (a session that had failed earlier) can pass for the outcome of this work.
 * While a dialog is open nothing is handed over; the sessions are looked at
 * again with the next read. A session that was deleted meanwhile is let go.
 *
 * It lives as long as the app does (the root route holds it), because the work
 * does: it is not a page's.
 */
export class FollowedSessions {
  readonly #queryClient: QueryClient;
  readonly #aDialogIsOpen: () => boolean;
  readonly #entries = new Map<number, Entry>();
  #listener: (finished: FinishedWork[]) => void = () => {};
  #generation = 0;
  #looking = false;
  #gathered: FinishedWork[] = [];
  #gathering: ReturnType<typeof setTimeout> | undefined;

  constructor(
    queryClient: QueryClient,
    dialogIsOpen: () => boolean = aDialogIsOpen,
  ) {
    this.#queryClient = queryClient;
    this.#aDialogIsOpen = dialogIsOpen;
  }

  /** Who is told of work that is over. Returns the way to stop telling them. */
  readonly listen = (listener: (finished: FinishedWork[]) => void) => {
    this.#listener = listener;
    return () => {
      if (this.#listener === listener) this.#listener = () => {};
    };
  };

  /** Looks at the session until its work is over. A session has one work: the latest. */
  readonly follow = (session: Session, work: FollowedWork) => {
    const id = session.id;
    this.#release(id);
    this.#generation += 1;
    const observer = new QueryObserver(this.#queryClient, {
      queryKey: [
        ...queryKeys.sessions,
        'followed',
        id,
        this.#generation,
      ] as const,
      // A session that is being deleted is let go without asking for it: the
      // backend could only answer that it is gone.
      queryFn: ({ signal }) =>
        removalOf(this.#queryClient, id) === 'none'
          ? sessionsApi.get(id, { signal })
          : Promise.reject(sessionGone()),
      refetchInterval: POLL_FAST_MS,
      // Nothing outlives the work it was read for.
      gcTime: 0,
      retry: false,
    });
    const entry: Entry = {
      work,
      read: () => observer.getCurrentResult(),
      unsubscribe: () => {},
    };
    this.#entries.set(id, entry);
    entry.unsubscribe = observer.subscribe(() => this.#look());
  };

  /** Stops looking at every session. */
  readonly dispose = () => {
    for (const id of this.#entries.keys()) this.#release(id);
    clearTimeout(this.#gathering);
    this.#gathering = undefined;
    this.#gathered = [];
  };

  #release(id: number): void {
    this.#entries.get(id)?.unsubscribe();
    this.#entries.delete(id);
  }

  #look(): void {
    if (this.#looking) return;
    this.#looking = true;
    try {
      const over: Array<{ id: number; finished: FinishedWork }> = [];
      const gone: number[] = [];
      for (const [id, { read, work }] of this.#entries) {
        const { data, error } = read();
        if (error instanceof ApiError && error.code === 'session_not_found') {
          gone.push(id);
        } else if (data !== undefined && !sessionIsBusy(data)) {
          over.push({ id, finished: { session: data, work } });
        }
      }
      const hold = over.length > 0 && this.#aDialogIsOpen();
      for (const id of gone) this.#release(id);
      if (hold) return;
      for (const { id } of over) this.#release(id);
      this.#gathered.push(...over.map(({ finished }) => finished));
      if (over.length > 0 && this.#gathering === undefined) {
        this.#gathering = setTimeout(() => this.#deliver(), GATHER_MS);
      }
    } finally {
      this.#looking = false;
    }
  }

  #deliver(): void {
    const finished = this.#gathered;
    this.#gathered = [];
    this.#gathering = undefined;
    if (finished.length > 0) this.#listener(finished);
  }
}
