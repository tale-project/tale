import { availableParallelism } from 'node:os';

import { planFrom } from '../servers.ts';

/**
 * Where the suite points, and its named time budgets, in one place so no spec
 * writes a raw millisecond literal. The servers under test
 * (`tests/e2e/server.ts`, one per worker) are fast: a fake browser starts a
 * session in 400 ms and a fake proxy check takes 150 ms, so the budgets below
 * are headroom for a slow CI machine, not an expectation.
 */

/**
 * The servers of the suite, resolved from the environment like the config and
 * the launcher resolve them. A spec never reads a port from here: it asks the
 * `server` fixture, which is the server of its own worker.
 */
export const PLAN = planFrom(process.env, availableParallelism());

export const TIMEOUT = {
  /** The first paint of a page after `goto`. */
  FIRST_PAINT: 30_000,
  /** An element or text appearing after an action the page answers at once. */
  VISIBLE: 10_000,
  /**
   * Work the backend does in the background: a session reaching "Running", a
   * proxy check finishing. The page polls every 1.5 s while something is busy.
   */
  BACKGROUND: 20_000,
  /** A picture arriving over the live view's socket. */
  PICTURE: 15_000,
} as const;
