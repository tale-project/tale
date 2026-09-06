/**
 * Platform event vocabulary shared by BOTH ends of the automation bus.
 *
 * The backend raises these through `backend/domains/events/emit.ts` (fan-out
 * to an org's `event` triggers inside the producing transaction); the web
 * app offers the same list in the trigger editors. The union is part of the
 * platform contract — subscription rows and automation packs reference these
 * exact strings — so it is declared ONCE here and imported by both sides:
 * extend deliberately, never rename, and a new event appears in the editor
 * the moment the backend can raise it.
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
