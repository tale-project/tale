import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Where an event comes from: the platform itself (a person's save, an
 * import, a sync the platform runs on its own) or an automation run. The
 * event triggers ask, because an event a run raises must not start that
 * run's automation again, nor anything at all when the run was itself
 * started by an event (AUTO-R12).
 *
 * The origin travels with the work, not with each signature: a producer
 * deep inside a task, comment or conversation write never names the run it
 * acts for. The scope is entered at the two doors every run's writes pass
 * through — the connector action host (a connector step of a run, natives
 * and the domain services they call included) and the workspace-tool door
 * (an automation's agent step, through its run's sandbox session) — and
 * `emitEvent` reads it.
 */
export type EventOrigin =
  | { kind: 'platform' }
  | { kind: 'automation'; runId: string };

const PLATFORM: EventOrigin = { kind: 'platform' };

const storage = new AsyncLocalStorage<EventOrigin>();

/** Run `fn` as the work of the automation run `runId`: every event it
 * raises, however deep, names that run as its origin. */
export function withAutomationOrigin<T>(runId: string, fn: () => T): T {
  return storage.run({ kind: 'automation', runId }, fn);
}

/** The origin of an event raised here: the run whose work this is, or the
 * platform outside any run. */
export function currentEventOrigin(): EventOrigin {
  return storage.getStore() ?? PLATFORM;
}
