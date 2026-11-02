import type { ApiError } from '@/app/lib/api/client';
import type { Session, SessionCreate } from '@/lib/api/schemas';

import { isRefusal, type Settled } from './settle';
import { readSharedIpConflict, type SharedIpConflict } from './shared-ip';
import { isStopped } from './status';

/** What the person was doing when a session needed a proxy it did not have. */
export type ProxyAction = 'create' | 'start' | 'rotate';

/** What a person decides when another running session exits through the session's IP. */
export type SharedIpChoice = 'cancel' | 'force' | 'rotate';

/** What a person decides when the proxy of a session does not work. */
export type BrokenProxyChoice = 'cancel' | 'rotate';

/**
 * How the first request of an action ended, for the control that made it:
 * the server did it (`done`), a dialog has taken over and the person decides
 * what follows (`asking`), or it was refused in a way the dialog around the
 * control may word itself, as a name that is taken (`refused`).
 */
export type Attempt =
  | { readonly kind: 'done' }
  | { readonly kind: 'asking' }
  | { readonly kind: 'refused'; readonly error: unknown };

/**
 * Where the keyboard goes back to when a dialog the flow opens for an action is
 * given up and the control that was pressed is gone: the opener of the dialog
 * that began the action, which that dialog has already closed.
 */
export type ReturnFocusTo = HTMLElement | null;

/**
 * Background work this tab made the server start for a session (a proxy to
 * assign, a browser to launch), and what to do when it is over.
 */
export interface FollowedWork {
  /** Does the action again, once proxies were added for a session that found none that worked. */
  retry: (session: Session) => Promise<unknown>;
  /** Starts the session when the work is over and it has stopped: it was given a new proxy for that. */
  thenStart: boolean;
}

/** Work whose session has been looked at again since it began, and is no longer busy. */
export interface FinishedWork {
  session: Session;
  work: FollowedWork;
}

/** What the flows need from the app around them: the server, the dialogs, the page. */
export interface FlowDeps {
  /** The server's answers; a refusal is a value, not a throw. */
  start: (id: number, force: boolean) => Promise<Settled<Session>>;
  rotate: (id: number) => Promise<Settled<Session>>;
  create: (input: Partial<SessionCreate>) => Promise<Settled<Session>>;
  /** The dialogs. They come one at a time, and each answers when the person decided. */
  askForProxies: (
    action: ProxyAction,
    returnFocusTo?: ReturnFocusTo,
  ) => Promise<boolean>;
  askForWorkingProxies: (sessions: readonly Session[]) => Promise<boolean>;
  askAboutSharedIp: (
    session: Session,
    conflict: SharedIpConflict,
  ) => Promise<SharedIpChoice>;
  askAboutBrokenProxy: (
    session: Session,
    error: ApiError,
  ) => Promise<BrokenProxyChoice>;
  /** Remembers work the server went on with, to look at the session again. */
  follow: (session: Session, work: FollowedWork) => void;
  /** Shows the page of a session, so that its start can be watched. */
  open: (sessionId: number) => void;
  /** Marks the session as busy with this tab's request while `request` runs. */
  track: <T>(
    sessionId: number,
    action: 'start' | 'rotate',
    request: Promise<T>,
  ) => Promise<T>;
  /** Tells a refusal that the control which would have worded it can no longer word. */
  tell: (action: ProxyAction, error: unknown) => void;
}

export interface ProxyFlows {
  /** Starts the session, and asks what to do when the server cannot yet. */
  start: (session: Session) => Promise<Attempt>;
  /**
   * Gives the session another working proxy; with `thenStart`, starts it once it
   * has one. The question that began a rotation closes for the dialog that asks
   * for proxies, so `returnFocusTo` names where the keyboard goes back to when
   * that one is given up.
   */
  rotate: (
    session: Session,
    options?: { thenStart?: boolean; returnFocusTo?: ReturnFocusTo },
  ) => Promise<Attempt>;
  /**
   * Adds a session, and asks for proxies when there is none to give it. The
   * dialog that took its name closes for the dialog that asks, so `returnFocusTo`
   * names where the keyboard goes back to when that one is given up.
   */
  create: (
    input: Partial<SessionCreate>,
    options?: { returnFocusTo?: ReturnFocusTo },
  ) => Promise<Attempt>;
  /** Work this tab began is over: what each of them needs next. */
  finished: (entries: readonly FinishedWork[]) => Promise<void>;
  /** A session that has no working proxy: asks for some, then starts it. */
  addProxiesFor: (session: Session) => Promise<void>;
}

/**
 * The actions that need a proxy of their own to give, in one place: adding a
 * session, starting it and giving it another proxy. They all go the same way.
 * The first request goes to the server. When it cannot be done yet the person
 * is asked (for proxies, whether to share an IP, whether to give a broken
 * proxy up) and the action goes on from the answer, with the same input.
 * Work the server then does in the background is followed: when it ends
 * because no proxy worked, the person is asked for proxies again.
 *
 * Every function answers as soon as its first request did: what follows is in
 * the hands of dialogs and runs on its own, so the control that made the
 * request is free again.
 */
export function createProxyFlows(deps: FlowDeps): ProxyFlows {
  /** What follows the first answer ends in the person's hands: a failure of ours is a bug, logged. */
  function detach(work: Promise<unknown>): void {
    work.catch((error: unknown) => {
      console.error('a proxy flow failed', error);
    });
  }

  /** Asks for proxies and, once some were added, does the action again. */
  async function withProxies(
    action: ProxyAction,
    again: () => Promise<unknown>,
    returnFocusTo?: ReturnFocusTo,
  ): Promise<void> {
    if (await deps.askForProxies(action, returnFocusTo)) await again();
  }

  async function start(session: Session, force = false): Promise<Attempt> {
    const result = await deps.track(
      session.id,
      'start',
      deps.start(session.id, force),
    );
    if (result.ok) {
      deps.follow(result.value, {
        thenStart: false,
        retry: (current) => start(current),
      });
      deps.open(session.id);
      return { kind: 'done' };
    }

    const { error } = result;
    if (isRefusal(error, 'no_free_proxy')) {
      detach(withProxies('start', () => start(session, force)));
      return { kind: 'asking' };
    }
    if (isRefusal(error, 'ip_in_use') && !force) {
      detach(decideOnSharedIp(session, error));
      return { kind: 'asking' };
    }
    if (isRefusal(error, 'proxy_unreachable')) {
      detach(decideOnBrokenProxy(session, error));
      return { kind: 'asking' };
    }
    // The mutation keeps quiet about `ip_in_use` because the dialog above
    // words it. Refused again although the start was forced, there is no
    // dialog left to do so: it is told here.
    if (isRefusal(error, 'ip_in_use')) deps.tell('start', error);
    return { kind: 'refused', error };
  }

  async function decideOnSharedIp(
    session: Session,
    error: ApiError,
  ): Promise<void> {
    const choice = await deps.askAboutSharedIp(
      session,
      readSharedIpConflict(error.extra),
    );
    if (choice === 'force') await start(session, true);
    else if (choice === 'rotate') await rotate(session, { thenStart: true });
  }

  async function decideOnBrokenProxy(
    session: Session,
    error: ApiError,
  ): Promise<void> {
    const choice = await deps.askAboutBrokenProxy(session, error);
    if (choice === 'rotate') await rotate(session, { thenStart: true });
  }

  async function rotate(
    session: Session,
    {
      thenStart = false,
      returnFocusTo,
    }: { thenStart?: boolean; returnFocusTo?: ReturnFocusTo } = {},
  ): Promise<Attempt> {
    const result = await deps.track(
      session.id,
      'rotate',
      deps.rotate(session.id),
    );
    if (result.ok) {
      const rotated = result.value;
      // The server restarts a running session with its new proxy. One that
      // then finds no proxy that works has been stopped by it, and has to be
      // started when it is given one, as one that was told to start.
      const startAfterwards = thenStart || !isStopped(rotated);
      deps.follow(rotated, {
        thenStart,
        retry: (current) => rotate(current, { thenStart: startAfterwards }),
      });
      return { kind: 'done' };
    }
    if (isRefusal(result.error, 'no_free_proxy')) {
      detach(
        withProxies(
          'rotate',
          () => rotate(session, { thenStart, returnFocusTo }),
          returnFocusTo,
        ),
      );
      return { kind: 'asking' };
    }
    return { kind: 'refused', error: result.error };
  }

  async function create(
    input: Partial<SessionCreate>,
    options: { returnFocusTo?: ReturnFocusTo } = {},
  ): Promise<Attempt> {
    const result = await deps.create(input);
    if (result.ok) {
      deps.follow(result.value, {
        thenStart: false,
        retry: (current) => start(current),
      });
      deps.open(result.value.id);
      return { kind: 'done' };
    }
    if (isRefusal(result.error, 'no_free_proxy')) {
      detach(
        withProxies(
          'create',
          () => createAfterProxies(input, options),
          options.returnFocusTo,
        ),
      );
      return { kind: 'asking' };
    }
    return { kind: 'refused', error: result.error };
  }

  /**
   * The dialog that took the name and the system is gone by now, so a name
   * that was taken meanwhile is told here; any other refusal was told already.
   */
  async function createAfterProxies(
    input: Partial<SessionCreate>,
    options: { returnFocusTo?: ReturnFocusTo },
  ): Promise<void> {
    const attempt = await create(input, options);
    if (
      attempt.kind === 'refused' &&
      isRefusal(attempt.error, 'name_taken', 'invalid_name')
    ) {
      deps.tell('create', attempt.error);
    }
  }

  /** One dialog for every session that found no proxy that works; each tries again once there are some. */
  async function recover(stuck: readonly FinishedWork[]): Promise<void> {
    const asked = await deps.askForWorkingProxies(
      stuck.map(({ session }) => session),
    );
    if (!asked) return;
    await Promise.all(stuck.map(({ session, work }) => work.retry(session)));
  }

  async function finished(entries: readonly FinishedWork[]): Promise<void> {
    const stuck = entries.filter(
      ({ session }) => session.errorCode === 'no_working_proxy',
    );
    const toStart = entries.filter(
      ({ session, work }) =>
        session.errorCode !== 'no_working_proxy' &&
        work.thenStart &&
        isStopped(session),
    );
    await Promise.all([
      ...toStart.map(({ session }) => start(session)),
      stuck.length > 0 ? recover(stuck) : Promise.resolve(),
    ]);
  }

  return {
    start: (session) => start(session),
    rotate,
    create,
    finished,
    addProxiesFor: (session) =>
      recover([
        {
          session,
          work: { thenStart: false, retry: (current) => start(current) },
        },
      ]),
  };
}
