import type { TFunction } from 'i18next';

import { EMITTED_EVENT_TYPES, type EventType } from '@/lib/shared/event-types';

/**
 * How the platform's events read in the trigger's event field: each in a
 * group of what it is about, under a name and one plain sentence of when
 * it is raised. The event's own id stays beside it, since packs, the API
 * and MCP name it.
 *
 * Every key is read through a literal, so the catalogs' usage guard sees
 * each one; a new event type fails to compile here until it has words.
 */

export type EventGroup =
  | 'tasks'
  | 'comments'
  | 'conversations'
  | 'contacts'
  | 'projects';

/** The groups, in the order the field lists them. */
export const EVENT_GROUPS = [
  'tasks',
  'comments',
  'conversations',
  'contacts',
  'projects',
] as const satisfies readonly EventGroup[];

/** What an event is about. */
function eventGroup(type: EventType): EventGroup {
  switch (type) {
    case 'task.created':
    case 'task.status_changed':
      return 'tasks';
    case 'comment.created':
    case 'comment.mentioned':
      return 'comments';
    case 'conversation.created':
    case 'conversation.message_received':
      return 'conversations';
    case 'contact.created':
    case 'contact.updated':
    case 'contact.deleted':
      return 'contacts';
    case 'project.created':
      return 'projects';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/** A group's heading. */
export function eventGroupLabel(group: EventGroup, t: TFunction): string {
  switch (group) {
    case 'tasks':
      return t('trigger.events.group.tasks');
    case 'comments':
      return t('trigger.events.group.comments');
    case 'conversations':
      return t('trigger.events.group.conversations');
    case 'contacts':
      return t('trigger.events.group.contacts');
    case 'projects':
      return t('trigger.events.group.projects');
    default: {
      const exhaustive: never = group;
      return exhaustive;
    }
  }
}

/** An event's name and when it is raised, in the reader's language. */
export function eventWords(
  type: EventType,
  t: TFunction,
): { label: string; description: string } {
  switch (type) {
    case 'contact.created':
      return {
        label: t('trigger.events.contactCreated.label'),
        description: t('trigger.events.contactCreated.description'),
      };
    case 'contact.updated':
      return {
        label: t('trigger.events.contactUpdated.label'),
        description: t('trigger.events.contactUpdated.description'),
      };
    case 'contact.deleted':
      return {
        label: t('trigger.events.contactDeleted.label'),
        description: t('trigger.events.contactDeleted.description'),
      };
    case 'conversation.created':
      return {
        label: t('trigger.events.conversationCreated.label'),
        description: t('trigger.events.conversationCreated.description'),
      };
    case 'conversation.message_received':
      return {
        label: t('trigger.events.conversationMessageReceived.label'),
        description: t(
          'trigger.events.conversationMessageReceived.description',
        ),
      };
    case 'project.created':
      return {
        label: t('trigger.events.projectCreated.label'),
        description: t('trigger.events.projectCreated.description'),
      };
    case 'task.created':
      return {
        label: t('trigger.events.taskCreated.label'),
        description: t('trigger.events.taskCreated.description'),
      };
    case 'task.status_changed':
      return {
        label: t('trigger.events.taskStatusChanged.label'),
        description: t('trigger.events.taskStatusChanged.description'),
      };
    case 'comment.created':
      return {
        label: t('trigger.events.commentCreated.label'),
        description: t('trigger.events.commentCreated.description'),
      };
    case 'comment.mentioned':
      return {
        label: t('trigger.events.commentMentioned.label'),
        description: t('trigger.events.commentMentioned.description'),
      };
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/** The emitted events of one group, in the vocabulary's order. */
export function eventsOf(group: EventGroup): EventType[] {
  return EMITTED_EVENT_TYPES.filter((type) => eventGroup(type) === group);
}
