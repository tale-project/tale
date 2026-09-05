import type { TransactionSql } from 'postgres';

import type { EventType } from '../../../lib/shared/event-types.ts';
import { dispatchAutomationEvent } from '../automations/triggers.ts';

/**
 * Platform events — the single seam through which entity domains announce
 * "something happened". Dispatch fans out to the org's enabled `event`
 * automation triggers INSIDE the producing transaction (run insert + step
 * job enqueue commit atomically with the write that raised the event);
 * emitting stays non-fatal — a dispatch fault is logged, never allowed to
 * fail the producing write.
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
 * never be able to fail its producer.
 */
export async function emitEvent(
  tx: TransactionSql,
  args: EmitEventArgs,
): Promise<void> {
  try {
    await dispatchAutomationEvent(tx, {
      organizationId: args.organizationId,
      event: args.eventType,
      ...(args.eventData !== undefined ? { payload: args.eventData } : {}),
      origin: 'platform',
    });
  } catch (error) {
    console.error(
      `[events] automation dispatch failed for ${args.eventType} (org ${args.organizationId}):`,
      error,
    );
  }
}
