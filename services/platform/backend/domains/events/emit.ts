import type { TransactionSql } from 'postgres';

import type { EventType } from '../../../lib/shared/event-types.ts';
import { dispatchAutomationEvent } from '../automations/triggers.ts';

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
 * The event-type union lives in `lib/shared/event-types.ts`, shared with the
 * trigger editors in the web app.
 */

export interface EmitEventArgs {
  organizationId: string;
  eventType: EventType;
  eventData?: Record<string, unknown>;
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
export async function emitEvent(
  tx: TransactionSql,
  args: EmitEventArgs,
): Promise<void> {
  try {
    await tx.savepoint((sp) =>
      dispatchAutomationEvent(sp, {
        organizationId: args.organizationId,
        event: args.eventType,
        ...(args.eventData !== undefined ? { payload: args.eventData } : {}),
        origin: 'platform',
      }),
    );
  } catch (error) {
    console.error(
      `[events] automation dispatch failed for ${args.eventType} (org ${args.organizationId}):`,
      error,
    );
  }
}
