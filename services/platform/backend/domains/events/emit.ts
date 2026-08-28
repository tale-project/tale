import type { TransactionSql } from 'postgres';

import { dispatchAutomationEvent } from '../automations/triggers.ts';

/**
 * Platform events — the single seam through which entity domains announce
 * "something happened". Dispatch fans out to the org's enabled `event`
 * automation triggers INSIDE the producing transaction (run insert + step
 * job enqueue commit atomically with the write that raised the event);
 * emitting stays non-fatal — a dispatch fault is logged, never allowed to
 * fail the producing write.
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
