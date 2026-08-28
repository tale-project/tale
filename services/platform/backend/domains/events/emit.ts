import type { TransactionSql } from 'postgres';

/**
 * Platform events — the single seam through which entity domains announce
 * "something happened". Ported from `convex/events/emit.ts` at its current
 * contract: dispatch is a deliberate NO-OP until the automations domain
 * lands its fan-out (per-org subscription lookup + run scheduling + the
 * workflow.completed self-trigger guard); emitting stays non-fatal and
 * cheap, so producing domains call this seam today and the rebuild swaps in
 * the real dispatch behind it.
 *
 * The event-type union is part of the platform contract (subscription rows
 * and automation packs reference these exact strings) — extend deliberately,
 * never rename.
 */
export const EVENT_TYPES = [
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'conversation.created',
  'conversation.message_received',
  'conversation.closed',
  'workflow.completed',
  'project.created',
  'task.created',
  'task.status_changed',
  'task.assigned',
  'task.mentioned',
  'task.deleted',
  'comment.created',
  'comment.mentioned',
  'task.external_run_failed',
  'agent.budget_exceeded',
  'agent.slot_freed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export function isValidEventType(type: string): type is EventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}

export interface EmitEventArgs {
  organizationId: string;
  eventType: EventType;
  eventData?: Record<string, unknown>;
}

let droppedEventCount = 0;

/**
 * Emit a platform event inside the producing transaction. Fire-and-forget by
 * contract: the write commits regardless of what (if anything) consumes it.
 */
export async function emitEvent(
  _tx: TransactionSql,
  args: EmitEventArgs,
): Promise<void> {
  // TODO(automations): replace with the subscription fan-out (enqueue run
  // jobs in this same transaction).
  droppedEventCount += 1;
  if (droppedEventCount <= 5 || droppedEventCount % 100 === 0) {
    console.debug(
      `[events] dropped ${args.eventType} for org ${args.organizationId} (automation dispatch not yet rebuilt; #${droppedEventCount})`,
    );
  }
  return Promise.resolve();
}
