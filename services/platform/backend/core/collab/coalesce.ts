/**
 * The COLLAPSE identity for personal notifications.
 *
 * A person cares about the CURRENT state of a thing, not about every keystroke
 * that produced it. Assigning someone, unassigning them, and assigning them
 * again used to write three bell rows and schedule three emails; the first two
 * were obsolete before they were read. So every row that describes a state (who
 * owns it, who reviews it, where it stands, when it's due) carries a
 * `coalesceKey` — `<resourceKind>:<resourceId>:<dimension>` — and while a row
 * with that key is UNREAD a later event on the same dimension REWRITES it in
 * place. Content-bearing rows (a comment, a mention) never collapse: each says
 * something different, and collapsing would lose it.
 *
 * This module is the pure half: the key. The write path that applies it (the
 * rewrite-in-place, the `undoes` drop, the debounced email through the
 * `notification.email` job with its epoch fence) is
 * `domains/collab/service.ts` (`writeCoalescedNotification`) and the sink is
 * `domains/collab/email-sink.ts`. Read rows are never touched — once someone
 * has seen a notification it is part of their history, so the next event
 * starts a fresh row.
 */

import type { Doc, Id } from '../lib/rows';
import type { NotificationType } from './types';

type ResourceType = Doc<'userNotifications'>['resourceType'];

/**
 * How long a notification's email waits for a better version of itself. Long
 * enough to swallow a burst of edits (a picker fiddled with, a drag undone),
 * short enough that a review request still lands while the reviewer is at their
 * desk.
 */
export const NOTIFICATION_EMAIL_DEBOUNCE_MS = 60_000;

/**
 * The state a notification type talks about. Types sharing a dimension for the
 * same resource are versions of one another; types with no dimension are events
 * that stand alone.
 */
const DIMENSION: Partial<Record<NotificationType, string>> = {
  // Who owns the work.
  task_assigned: 'assignment',
  task_unassigned: 'assignment',
  conversation_assigned: 'assignment',
  // Who the gate waits on, and whether it is open.
  task_review_requested: 'review',
  task_review_resolved: 'review',
  task_reviewer_assigned: 'review',
  document_review_requested: 'review',
  document_review_resolved: 'review',
  // Where the work stands.
  task_status_changed: 'status',
  // When it is due.
  task_deadline: 'deadline',
  // The agent's open question on the work (`notify_agent_asks.ts`): a folded
  // follow-up question rewrites the unread ask row instead of stacking a
  // second card next to it.
  agent_escalation: 'question',
  // Deliberately absent — each carries its own content, so each is its own row:
  // mention, task_commented, conversation_message.
};

/**
 * The collapse identity for one notification, or null when this type must never
 * collapse. Keyed on the RESOURCE the state belongs to (a task, a conversation,
 * a document), not on the row's deep-link target: a review request points at its
 * approval and the resolution at the task, yet both describe one gate.
 */
export function coalesceKeyFor(args: {
  type: NotificationType;
  resourceType: ResourceType;
  resourceId: string;
  taskId?: Id<'tasks'>;
  params?: Record<string, unknown>;
}): string | null {
  const dimension = DIMENSION[args.type];
  if (dimension === undefined) return null;
  const subject = coalesceSubject(args);
  return subject === null ? null : `${subject}:${dimension}`;
}

/** `<kind>:<id>` of the thing whose state this notification describes. */
function coalesceSubject(args: {
  resourceType: ResourceType;
  resourceId: string;
  taskId?: Id<'tasks'>;
  params?: Record<string, unknown>;
}): string | null {
  if (args.taskId !== undefined) return `task:${args.taskId}`;
  if (args.resourceType === 'task') return `task:${args.resourceId}`;
  const conversationId = args.params?.conversationId;
  if (typeof conversationId === 'string') {
    return `conversation:${conversationId}`;
  }
  if (args.resourceType === 'conversation') {
    return `conversation:${args.resourceId}`;
  }
  const documentId = args.params?.documentId;
  if (typeof documentId === 'string') return `document:${documentId}`;
  if (args.resourceType === 'document') return `document:${args.resourceId}`;
  // A dimension we can't tie to a subject would collapse unrelated rows
  // together, so it collapses nothing instead.
  return null;
}
