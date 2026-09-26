import { chatDraftKey } from '@/app/features/chat/lib/draft-key';
import { messageDraftKeys } from '@/app/features/conversations/components/message-editor/types';
import { taskCommentDraftKey } from '@/app/features/tasks/lib/draft-key';

import type { HomeItem } from './home-items';

/** Where each kind's composer keeps its unsent text: a chat's message, a
 * task's comment, a conversation's reply. */
export function homeDraftKey(
  item: Pick<HomeItem, 'kind' | 'id'>,
  userId: string | undefined,
  organizationId: string,
): string {
  if (item.kind === 'chat')
    return chatDraftKey(userId, organizationId, item.id);
  if (item.kind === 'task') {
    return taskCommentDraftKey(userId, organizationId, item.id);
  }
  return messageDraftKeys(userId, item.id).body;
}

/**
 * Whether a composer left something unsent under `key` — read from the same
 * store the composers write, so a row can say "Draft" the way a chat list
 * marks the conversation you were typing in. Markup alone (an emptied rich
 * text field) is not a draft.
 */
export function hasDraft(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return false;
    const value: unknown = JSON.parse(raw);
    return (
      typeof value === 'string' &&
      value
        .replaceAll(/<[^>]*>/g, '')
        .replaceAll('&nbsp;', ' ')
        .trim().length > 0
    );
  } catch (error) {
    console.warn(`Could not read the draft stored under "${key}"`, error);
    return false;
  }
}
