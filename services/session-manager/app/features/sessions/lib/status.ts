import type { Session } from '@/lib/api/schemas';

/**
 * What a session shows as its state: its background work comes before its
 * status (a session that is being given a proxy is still "stopped" to the
 * backend), except that a stop wins: once the person asked to stop, "Stopping"
 * stays until the browser has closed, though its launch is still at work.
 */
export type ShownStatus =
  | 'stopped'
  | 'assigning'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export function shownStatus(session: Session): ShownStatus {
  if (session.status === 'stopping') return 'stopping';
  if (session.activity === 'assigning_proxy') return 'assigning';
  if (session.activity === 'launching') return 'starting';
  return session.status;
}

/** The colour language of a state, for a dot or a badge. */
export type StatusTone = 'idle' | 'accent' | 'ok' | 'warn' | 'danger';

const TONES: Record<ShownStatus, StatusTone> = {
  stopped: 'idle',
  assigning: 'accent',
  starting: 'accent',
  running: 'ok',
  stopping: 'warn',
  error: 'danger',
};

export function statusTone(status: ShownStatus): StatusTone {
  return TONES[status];
}

/**
 * A running session whose proxy now exits through another IP than the one its
 * timezone and location are for.
 */
export function outOfSync(session: Session): boolean {
  return session.status === 'running' && session.location?.inSync === false;
}

/**
 * The browser is not up and not on its way: stopped or failed. Unlike `isIdle`
 * it says nothing of the background work (a stopped session being given a
 * proxy is still a stopped one).
 */
export function isStopped(session: Session): boolean {
  return session.status === 'stopped' || session.status === 'error';
}

/** No task of the session is at work: it can be started, or its proxy rotated. */
export function isIdle(session: Session): boolean {
  return (
    session.activity === null &&
    (session.status === 'stopped' || session.status === 'error')
  );
}
