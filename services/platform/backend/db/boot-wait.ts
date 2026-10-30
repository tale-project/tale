import { withRetry } from '@tale/shared/db/retry';

import { isDatabaseUnavailable, ROUTINE_RESTART_MS } from './unavailable.ts';

/**
 * How a booting process waits out an unavailable database.
 *
 * A process that boots while the database restarts — a container restarted
 * while `db` restarts, a host boot racing it, a managed upgrade recreating
 * `db` — meets the restart wherever its boot happens to be. The steps the
 * boot cannot do without run through this wait: the migrator's first query
 * (`db/migrate.ts`), pg-boss starting and creating its queues right after
 * (`jobs/boss.ts`), and the schedules and MCP resources (`main.ts`). Each
 * such step runs again with backoff while it fails because the database is
 * unavailable (`db/unavailable.ts`), until `waitMs` has passed since the
 * first refusal. Any other failure, and an outage that outlasts the wait,
 * rejects at once, and the boot reports the error and exits. The boot's
 * best-effort steps do not wait; `main.ts` says which. The knowledge
 * database's steps wait too, and go on without the step instead of exiting
 * (`domains/knowledge/boot.ts`).
 *
 * The clock is one per boot and database, deliberately: every step a boot
 * runs through it shares it, so a second outage in the same boot is timed
 * from the first one's first refusal, the time between the two included. A
 * database that keeps going away cannot hold the boot without it ever being
 * reported. The knowledge database has a wait of its own, so a knowledge
 * database that comes back after the app database is not timed from the app
 * database's refusals.
 */

/** The first pause after an attempt the database was unavailable for; it
 * doubles from here up to {@link DATABASE_RETRY_MAX_DELAY_MS}. */
const DATABASE_RETRY_BASE_DELAY_MS = 1_000;

/** The longest pause between two attempts — how late a booting process at
 * most notices that the database is back. */
const DATABASE_RETRY_MAX_DELAY_MS = 5_000;

interface BootDatabaseWaitOptions {
  /**
   * How long an unavailable database is waited out, timed from its first
   * refusal, before a step gives up; {@link ROUTINE_RESTART_MS} by default.
   */
  waitMs?: number;
  /** The pause between two attempts (injectable for deterministic tests). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * The outage's clock, in milliseconds: monotonic `performance.now()` by
   * default, so a wall-clock step as the host syncs its time at boot neither
   * cuts the wait short nor stretches it (injectable for deterministic tests).
   */
  now?: () => number;
}

/** Run one boot step, waiting out an unavailable database (see the module
 * note). Every step it runs shares one outage clock. */
export type BootDatabaseWait = <T>(step: () => Promise<T>) => Promise<T>;

/** One boot's wait: create it once per process and run every boot step that
 * needs the database through it. */
export function createBootDatabaseWait(
  options: BootDatabaseWaitOptions = {},
): BootDatabaseWait {
  const waitMs = options.waitMs ?? ROUTINE_RESTART_MS;
  const clock = options.now ?? (() => performance.now());
  let outageSince: number | null = null;
  return (step) =>
    withRetry(step, {
      // The outage's clock below, not a count or a budget, ends the retries.
      attempts: Number.POSITIVE_INFINITY,
      timeoutMs: Number.POSITIVE_INFINITY,
      baseDelayMs: DATABASE_RETRY_BASE_DELAY_MS,
      maxDelayMs: DATABASE_RETRY_MAX_DELAY_MS,
      isTransient: (error) => {
        // Every client a boot step opens is a database client — postgres.js,
        // pg-boss's node-postgres pool, Better Auth's node-postgres migrator
        // — so a bare socket error is the database's too.
        if (!isDatabaseUnavailable(error, { fromDatabase: true })) return false;
        const now = clock();
        outageSince ??= now;
        return now - outageSince < waitMs;
      },
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    });
}

/**
 * One write that must land, run through a database restart on a clock of its
 * own: the settle of a chat turn, say, which has no boot to share a clock
 * with. A reply that had streamed for half a minute lost its settle to a
 * three-second restart — `transactSerializable` reruns a dropped connection
 * eight times, about two and a half seconds in all, which ends before a
 * restarting container answers — and its placeholder stayed `pending`, with
 * nothing left to write the failure, until the generation sweep took the turn
 * for dead ten minutes on. Only an unavailable database is waited out; any
 * other failure, and an outage that outlasts the wait, rejects at once.
 */
export function waitOutDatabaseOutage<T>(
  write: () => Promise<T>,
  options: BootDatabaseWaitOptions = {},
): Promise<T> {
  return createBootDatabaseWait(options)(write);
}
