import type { TransactionSql } from 'postgres';

import type {
  EventPayloads,
  EventType,
} from '../../../lib/shared/event-types.ts';
import { dispatchAutomationEvent } from '../automations/triggers.ts';
import { currentEventOrigin, type EventOrigin } from './origin.ts';

/**
 * Platform events — the single seam through which entity domains announce
 * "something happened". Dispatch fans out to the org's enabled `event`
 * automation triggers INSIDE the producing transaction (run insert + step
 * job enqueue commit atomically with the write that raised the event);
 * emitting stays non-fatal — a dispatch fault is logged, never allowed to
 * fail the producing write. Dispatch runs under a SAVEPOINT for that reason:
 * a JS catch alone cannot un-abort a Postgres transaction, so a SQL fault in
 * dispatch (a constraint on the run insert, a refused job enqueue) would
 * otherwise leave the caller's transaction aborted — its next statement dies
 * with 25P02, or its COMMIT silently rolls the producing write back.
 *
 * The event-type union and what each event carries live in
 * `lib/shared/event-types.ts`, shared with the trigger editors in the web
 * app: the compiler holds every producer to its event's documented payload.
 * Where the event comes from — the platform, or an automation run whose work
 * raised it — is read from the scope the run's doors entered (`origin.ts`).
 */

export interface EmitEventArgs<T extends EventType> {
  organizationId: string;
  eventType: T;
  eventData: EventPayloads[T];
  /** Only for tests: a producer never names its origin, the scope does. */
  origin?: EventOrigin;
}

/**
 * Emit a platform event inside the producing transaction. Fire-and-forget by
 * contract: the write commits regardless of what (if anything) consumes it —
 * a dispatch fault is logged and swallowed, because an event consumer must
 * never be able to fail its producer. The savepoint scopes that promise to
 * SQL faults too: a failed dispatch rolls back to the savepoint (its trigger
 * stamp, run rows and job enqueue go with it) and the outer transaction
 * stays valid for the producer's remaining statements and its commit.
 */
export async function emitEvent<T extends EventType>(
  tx: TransactionSql,
  args: EmitEventArgs<T>,
): Promise<void> {
  const origin = args.origin ?? currentEventOrigin();
  try {
    await tx.savepoint((sp) =>
      dispatchAutomationEvent(sp, {
        organizationId: args.organizationId,
        event: args.eventType,
        payload: args.eventData,
        origin,
      }),
    );
  } catch (error) {
    console.error(
      `[events] automation dispatch failed for ${args.eventType} (org ${args.organizationId}):`,
      error,
    );
  }
}
