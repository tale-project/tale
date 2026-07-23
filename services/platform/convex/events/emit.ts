import type { ActionCtx, MutationCtx } from '../_generated/server';

/**
 * Platform events — the single seam through which entity domains announce
 * "something happened" (contact created, conversation closed, task mentioned,
 * …). Automations subscribe to these events; the emitting domain never knows
 * or cares who listens.
 *
 * Dispatch is intentionally a NO-OP while the automation
 * engine is rebuilt. Emitting must stay non-fatal and cheap — creating a
 * contact works whether or not anything subscribes — so callers keep calling
 * this seam and the automation-engine rebuild swaps in the real fan-out (per-org subscription
 * lookup + run scheduling + the workflow.completed self-trigger guard).
 *
 * The event-type union is part of the platform contract: existing
 * subscription rows and automation packs reference these exact strings.
 * Extend deliberately; never rename.
 */
export const EVENT_TYPES = [
  'discussion.created',
  'discussion.reply',
  'discussion.mentioned',
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

/**
 * Emit a platform event from a mutation. Fire-and-forget by contract: the
 * emitting write commits regardless of what (if anything) consumes the event.
 */
export async function emitEvent(
  ctx: MutationCtx,
  args: EmitEventArgs,
): Promise<void> {
  void ctx;
  logDroppedEvent(args);
}

/** Emit a platform event from an action (same contract as `emitEvent`). */
export async function emitEventFromAction(
  ctx: ActionCtx,
  args: EmitEventArgs,
): Promise<void> {
  void ctx;
  logDroppedEvent(args);
}

/** Phase-5 placeholder: record that an event occurred and was not dispatched. */
function logDroppedEvent(args: EmitEventArgs): void {
  console.debug(
    `[events] ${args.eventType} for org ${args.organizationId} dropped — automation dispatch offline until the automations rewrite lands`,
  );
}
