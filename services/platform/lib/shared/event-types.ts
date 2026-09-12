/**
 * Platform event vocabulary shared by BOTH ends of the automation bus.
 *
 * The backend raises these through `backend/domains/events/emit.ts` (fan-out
 * to an org's `event` triggers inside the producing transaction); the web
 * app offers the same list in the trigger editors, and the REST trigger door
 * refuses any other name. The union is part of the platform contract —
 * subscription rows and automation packs reference these exact strings — so
 * it is declared ONCE here and imported by both sides: extend deliberately,
 * never rename.
 *
 * Two lists, because a name nobody raises is a trap: a trigger bound to it
 * saves green, reads as enabled, and never fires. `EMITTED_EVENT_TYPES` is
 * exactly the set some producing write names today —
 * `event-types.test.ts` holds it to the `eventType:` literals under
 * `backend/domains`, so a new producer moves its name here in the same
 * change and a name without a producer cannot stay here. The reserved list
 * is the vocabulary the platform intends to raise and does not yet: no
 * editor offers it and no trigger may bind it, so nobody waits on an event
 * that never comes.
 */
export const EMITTED_EVENT_TYPES = [
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'conversation.created',
  'conversation.message_received',
  'project.created',
  'task.created',
  'task.status_changed',
  'comment.created',
  'comment.mentioned',
] as const;
export type EventType = (typeof EMITTED_EVENT_TYPES)[number];

/** Declared, not raised — see the module header. A producer that starts
 * raising one MOVES it into `EMITTED_EVENT_TYPES` (the guard test insists). */
export const RESERVED_EVENT_TYPES = [
  'conversation.closed',
  'workflow.completed',
  'task.assigned',
  'task.mentioned',
  'task.deleted',
  'task.external_run_failed',
  'agent.budget_exceeded',
  'agent.slot_freed',
] as const;

const EMITTED: ReadonlySet<string> = new Set(EMITTED_EVENT_TYPES);

/** Whether a name is an event the platform raises today — what an event
 * trigger may bind. */
export function isEmittedEventType(value: string): value is EventType {
  return EMITTED.has(value);
}
