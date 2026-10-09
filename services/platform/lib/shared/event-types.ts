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

/** Someone a comment names. */
export interface EventMention {
  type: 'user' | 'agent' | 'automation';
  id: string;
}

/** A task comment as its events carry it. */
export interface EventComment {
  /** The comment as stored: a mention is a mention token,
   * `[@Ada Lovelace](mention:user/<id>)`. */
  body: string;
  /** The same text with every mention read as `@` and the name. */
  bodyText: string;
  projectId: string;
  taskId: string;
  mentions: EventMention[];
}

/**
 * What each event carries as its `payload` — the `eventData` its producer
 * writes, and so what an event-started run receives under `payload`.
 * Statuses are the task board's (`todo`, `in_progress`, …).
 */
export interface EventPayloads {
  'contact.created': { contactId: string };
  'contact.updated': { contactId: string };
  'contact.deleted': { contactId: string };
  'conversation.created': { conversationId: string; channel: string | null };
  'conversation.message_received': {
    conversationId: string;
    messageId: string;
    direction: 'inbound' | 'outbound';
  };
  'project.created': { projectId: string; name: string; actorId: string };
  'task.created': {
    taskId: string;
    projectId: string;
    actorType: 'user' | 'agent' | 'workflow' | 'system';
    actorId: string;
  };
  'task.status_changed': {
    taskId: string;
    projectId: string;
    fromStatus: string;
    toStatus: string;
    actorType: 'user';
    actorId: string;
  };
  'comment.created': { comment: EventComment };
  'comment.mentioned': {
    comment: EventComment;
    taskId: string;
    mentions: EventMention[];
    actorType: 'user';
    actorId: string;
  };
}

const EXAMPLE_PROJECT = '0b9c6a52-5d1e-4f0a-9c3e-2f6d8a1b7e40';
const EXAMPLE_TASK = '5e2f9d34-8a71-4c6b-b0d2-91a7e3c4f815';
const EXAMPLE_USER = 'c41d7e88-2b3a-4f95-8e60-7d5a9b1c0f23';
const EXAMPLE_CONTACT = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const EXAMPLE_CONVERSATION = '3f1e2d4c-6b5a-4978-8a1b-2c3d4e5f6a7b';
const EXAMPLE_COMMENT: EventComment = {
  body: `[@Ada Lovelace](mention:user/${EXAMPLE_USER}) can you check the invoice total?`,
  bodyText: '@Ada Lovelace can you check the invoice total?',
  projectId: EXAMPLE_PROJECT,
  taskId: EXAMPLE_TASK,
  mentions: [{ type: 'user', id: EXAMPLE_USER }],
};

/**
 * One realistic payload per emitted event — what the trigger editor shows
 * a run would receive, and what a trigger's inputs are checked against
 * before any event has happened.
 */
export const EVENT_PAYLOAD_EXAMPLES = {
  'contact.created': { contactId: EXAMPLE_CONTACT },
  'contact.updated': { contactId: EXAMPLE_CONTACT },
  'contact.deleted': { contactId: EXAMPLE_CONTACT },
  'conversation.created': {
    conversationId: EXAMPLE_CONVERSATION,
    channel: 'email',
  },
  'conversation.message_received': {
    conversationId: EXAMPLE_CONVERSATION,
    messageId: '6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a',
    direction: 'inbound',
  },
  'project.created': {
    projectId: EXAMPLE_PROJECT,
    name: 'Billing',
    actorId: EXAMPLE_USER,
  },
  'task.created': {
    taskId: EXAMPLE_TASK,
    projectId: EXAMPLE_PROJECT,
    actorType: 'user',
    actorId: EXAMPLE_USER,
  },
  'task.status_changed': {
    taskId: EXAMPLE_TASK,
    projectId: EXAMPLE_PROJECT,
    fromStatus: 'todo',
    toStatus: 'in_progress',
    actorType: 'user',
    actorId: EXAMPLE_USER,
  },
  'comment.created': { comment: EXAMPLE_COMMENT },
  'comment.mentioned': {
    comment: EXAMPLE_COMMENT,
    taskId: EXAMPLE_TASK,
    mentions: EXAMPLE_COMMENT.mentions,
    actorType: 'user',
    actorId: EXAMPLE_USER,
  },
} satisfies { [K in EventType]: EventPayloads[K] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The project an event belongs to, read from its payload: a task's or a
 * project's own, a comment's task's. Contact and conversation events
 * belong to none, and a payload without one names none.
 */
export function eventProjectId(
  type: EventType,
  payload: unknown,
): string | null {
  if (!isRecord(payload)) return null;
  const holder = type.startsWith('comment.') ? payload.comment : payload;
  if (
    !type.startsWith('task.') &&
    !type.startsWith('comment.') &&
    type !== 'project.created'
  ) {
    return null;
  }
  return isRecord(holder) && typeof holder.projectId === 'string'
    ? holder.projectId
    : null;
}
