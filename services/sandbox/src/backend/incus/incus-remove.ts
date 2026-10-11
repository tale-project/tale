// Taking an instance away, for the session backend and the warm pool alike.
//
// Instances are ephemeral: a stopped one deletes itself, a moment after the
// stop answers. The removal therefore stops the instance and waits for it to
// go, and deletes it explicitly only when it stays (an instance made
// non-ephemeral by hand, or a deletion that did not run). Incus has no
// preconditioned stop or delete, so identity is checked by reading: when the
// caller knows the instance's creation time, a different instance under the
// name — a replacement made while this one went — is left alone.

import { INCUS_STATUS, incusStatus } from './incus-api.ts';
import type { IncusClient } from './incus-client.ts';

/** Polls for the instance to go: the first ones quickly, since an ephemeral
 * instance is usually gone by the time the stop answers. */
const POLLS = 60;
const FAST_POLLS = 10;
/** The poll at which an instance that is still there is deleted by hand, and
 * every this many polls after. */
const DELETE_FIRST_POLL = 4;
const DELETE_EVERY_POLLS = 10;
const OPERATION_WAIT_MS = 60_000;

export interface RemoveOptions {
  sleep: (ms: number) => Promise<void>;
  /** Let the instance shut itself down for this long before it is stopped
   * by force: runnerd passes a graceful stop on to every live exec. */
  graceMs?: number;
  /** Incus's creation time of the instance meant (`created_at`); another
   * instance under the name is not touched. */
  createdAt?: string;
}

/**
 * - `removed`: the instance was there and is gone;
 * - `absent`: there was none;
 * - `replaced`: another instance (a different creation time) holds the name
 *   — from the start, or since this one went — and it was not touched.
 * Throws when the instance is still there after the attempts.
 */
export type Removal = 'removed' | 'absent' | 'replaced';

function benignStopFailure(error: unknown): boolean {
  if (incusStatus(error) === 404) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /already stopped|not running/i.test(message);
}

export async function removeIncusInstance(
  client: IncusClient,
  name: string,
  options: RemoveOptions,
): Promise<Removal> {
  const found = await client.getInstance(name);
  if (found === undefined) return 'absent';
  if (
    options.createdAt !== undefined &&
    found.instance.createdAt !== options.createdAt
  ) {
    return 'replaced';
  }

  if (found.instance.statusCode !== INCUS_STATUS.stopped) {
    const graceMs = options.graceMs ?? 0;
    if (graceMs > 0) {
      try {
        await client.changeInstanceState(name, 'stop', {
          force: false,
          timeoutSeconds: Math.max(1, Math.ceil(graceMs / 1000)),
          waitMs: graceMs + OPERATION_WAIT_MS,
        });
      } catch (error) {
        if (!benignStopFailure(error)) {
          console.warn(
            `[sandbox.incus] the graceful stop of ${name} failed; stopping it at once:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
    try {
      await client.changeInstanceState(name, 'stop', {
        force: true,
        waitMs: OPERATION_WAIT_MS,
      });
    } catch (error) {
      // Stopped by the graceful attempt or gone already; the polls below say
      // which, and anything else shows up as the instance staying.
      if (!benignStopFailure(error)) {
        console.warn(
          `[sandbox.incus] stopping ${name}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  for (let poll = 0; poll < POLLS; poll += 1) {
    const current = await client.getInstance(name);
    if (current === undefined) return 'removed';
    if (
      options.createdAt !== undefined &&
      current.instance.createdAt !== options.createdAt
    ) {
      // Ours went, and a replacement took the name meanwhile: what runs
      // under the name now is not ours to count as freed.
      return 'replaced';
    }
    if (
      poll >= DELETE_FIRST_POLL &&
      (poll - DELETE_FIRST_POLL) % DELETE_EVERY_POLLS === 0
    ) {
      try {
        await client.deleteInstance(name, OPERATION_WAIT_MS);
      } catch (error) {
        console.warn(
          `[sandbox.incus] deleting ${name}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    await options.sleep(poll < FAST_POLLS ? 100 : 200);
  }
  throw new Error(`the instance ${name} is still there after its removal`);
}
