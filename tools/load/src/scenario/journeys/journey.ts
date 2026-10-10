/**
 * A journey: one thing a person sets out to do in the app — read a thread,
 * file a task, upload a document — as a sequence of requests with human
 * pauses between them. Journeys throw only `JourneyInterrupted` (through
 * `vu.guard()`/`vu.pause()`); a failed request is recorded by the request
 * layer and the journey carries on or returns, as a person would.
 */

import type { VirtualUser } from '../user.ts';

export interface Journey {
  /** Stable metric-friendly name, `<area>.<what>`. */
  readonly name: string;
  /** Whether this user can do it right now (role, options, state). */
  readonly eligible?: (vu: VirtualUser) => boolean;
  readonly run: (vu: VirtualUser) => Promise<void>;
}
