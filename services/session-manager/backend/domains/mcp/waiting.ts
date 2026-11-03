// Waiting for the background work of a session, which a tool does so that it
// can answer with how things ended up. Durations are milliseconds.

import type { Session } from '../../../lib/api/schemas.ts';
import type { Manager } from '../sessions/manager.ts';
import { sessionText } from './format.ts';
import { AccessOffError } from './tool.ts';
import type { ToolContext } from './tool.ts';

/** How long a start (or restart, or rotation) is waited for. */
export const START_TIMEOUT = 120_000;
export const STOP_TIMEOUT = 30_000;
/** How long a proxy check is waited for. */
export const CHECK_TIMEOUT = 40_000;

const POLL = 400;
/** How often a long wait looks whether AI access is still on. */
const ACCESS_CHECK = 250;
/** A start is only just under way when the manager answers. */
const START_GRACE = 200;

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Fails with `AccessOffError` once AI access is switched off (a context without a look never does). */
function assertAccessOn(context: ToolContext): void {
  if (context.accessOn?.() === false) throw new AccessOffError();
}

/**
 * Waits `ms` milliseconds, in short steps, giving up with `AccessOffError` as
 * soon as AI access is switched off: a long wait must not outlast the switch.
 */
export async function sleepWhileOn(
  context: ToolContext,
  ms: number,
): Promise<void> {
  assertAccessOn(context);
  let left = ms;
  // At least one step, also for no time at all: a wait is a turn of the event
  // loop, which lets the work being waited for go on.
  do {
    await sleep(Math.min(left, ACCESS_CHECK));
    assertAccessOn(context);
    left -= ACCESS_CHECK;
  } while (left > 0);
}

/** A short wait, as long as the context says (see `ToolContext.waitScale`). */
export function paced(context: ToolContext, ms: number): number {
  return ms * context.waitScale;
}

/**
 * Polls the session until `done`; it is returned as it is when the time is up
 * (the answer says how far it got).
 */
export async function until(
  context: ToolContext,
  sessionId: number,
  done: (session: Session) => boolean,
  timeoutMs: number,
): Promise<Session> {
  const { manager } = context;
  const deadline = Date.now() + timeoutMs;
  let session = manager.session(sessionId);
  while (!done(session) && Date.now() < deadline) {
    await sleepWhileOn(context, paced(context, POLL));
    session = manager.session(sessionId);
  }
  return session;
}

/** The session once its background work is over, with how many tabs it has if it runs. */
export async function untilStarted(context: ToolContext, sessionId: number) {
  await sleepWhileOn(context, paced(context, START_GRACE));
  const session = await until(
    context,
    sessionId,
    (current) =>
      current.activity === null &&
      (current.status === 'running' ||
        current.status === 'error' ||
        current.status === 'stopped'),
    START_TIMEOUT,
  );
  const result = sessionText(session);
  if (session.status !== 'running') return result;
  return { ...result, tabs: tabsOf(context.manager, sessionId) };
}

function tabsOf(manager: Manager, sessionId: number): number {
  return manager.remote(sessionId).tabs().length;
}
