/**
 * The Home stream's one vocabulary: every chat, task and inbox conversation
 * the caller works on, reduced to the same row shape so a single list can
 * hold all three. The feature owners keep their own models — this is a view
 * model derived from them, never stored.
 */

import type { TaskStatus } from '@/app/features/tasks/lib/display';

export type HomeItemKind = 'chat' | 'task' | 'conversation';

/** The Home panel's view switcher: everything, or one kind of work. */
export type HomeView = 'all' | 'chats' | 'tasks' | 'inbox';

export const HOME_VIEWS: readonly HomeView[] = [
  'all',
  'chats',
  'tasks',
  'inbox',
];

export type InboxStatus = 'open' | 'closed' | 'spam' | 'archived';

export const INBOX_STATUSES: readonly InboxStatus[] = [
  'open',
  'closed',
  'spam',
  'archived',
];

interface HomeItemBase {
  readonly kind: HomeItemKind;
  readonly id: string;
  readonly title: string;
  /** The moment the item last moved — what the stream sorts and groups by. */
  readonly activityAt: number;
  /** Something arrived the caller has not seen yet. */
  readonly unread: boolean;
  /** The project the item belongs to, when it has one. */
  readonly projectId?: string;
}

export interface HomeChatItem extends HomeItemBase {
  readonly kind: 'chat';
  readonly pinnedAt?: number;
  /** A reply is being written right now. */
  readonly generating: boolean;
  readonly shared: boolean;
}

export interface HomeTaskItem extends HomeItemBase {
  readonly kind: 'task';
  /** `WEB-12`, when the project has a key and the task a number. */
  readonly identifier?: string | undefined;
  readonly status: TaskStatus;
  /** The task waits on the caller's review. */
  readonly awaitingMyReview: boolean;
}

export interface HomeConversationItem extends HomeItemBase {
  readonly kind: 'conversation';
  readonly status: InboxStatus;
  /** Who the conversation is with — a name, else an address. */
  readonly contactLabel?: string;
  readonly preview?: string;
}

export type HomeItem = HomeChatItem | HomeTaskItem | HomeConversationItem;

/** Which kinds a view shows. */
const VIEW_KIND: Record<Exclude<HomeView, 'all'>, HomeItemKind> = {
  chats: 'chat',
  tasks: 'task',
  inbox: 'conversation',
};

export function viewIncludes(view: HomeView, kind: HomeItemKind): boolean {
  return view === 'all' || VIEW_KIND[view] === kind;
}

/** The stream's time bands, newest first. `pinned` floats above them all. */
export type HomeGroupKey =
  | 'pinned'
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'earlier';

export interface HomeGroup {
  readonly key: HomeGroupKey;
  readonly items: readonly HomeItem[];
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local midnight `days` calendar days before the midnight `dayStart` —
 * counted in days, not 24-hour steps, so a daylight-saving change (a 23- or
 * 25-hour day) cannot shift a band's edge off midnight. */
function daysBefore(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

/**
 * Sorts the stream newest first and cuts it into time bands. Pinned chats
 * lead in their own band (newest pin first), the way the chat list always
 * floated them. `now` is passed in so render stays pure and a test can pin
 * the clock.
 */
export function groupHomeItems(
  items: readonly HomeItem[],
  now: number,
): HomeGroup[] {
  const today = startOfDay(now);
  const yesterday = daysBefore(today, 1);
  const weekAgo = daysBefore(today, 6);

  const pinned: HomeItem[] = [];
  const buckets: Record<Exclude<HomeGroupKey, 'pinned'>, HomeItem[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };

  const sorted = [...items].sort((a, b) => b.activityAt - a.activityAt);
  for (const item of sorted) {
    if (item.kind === 'chat' && item.pinnedAt !== undefined) {
      pinned.push(item);
      continue;
    }
    if (item.activityAt >= today) buckets.today.push(item);
    else if (item.activityAt >= yesterday) buckets.yesterday.push(item);
    else if (item.activityAt >= weekAgo) buckets.thisWeek.push(item);
    else buckets.earlier.push(item);
  }
  pinned.sort(
    (a, b) =>
      (b.kind === 'chat' ? (b.pinnedAt ?? 0) : 0) -
      (a.kind === 'chat' ? (a.pinnedAt ?? 0) : 0),
  );

  const groups: HomeGroup[] = [];
  if (pinned.length > 0) groups.push({ key: 'pinned', items: pinned });
  for (const key of ['today', 'yesterday', 'thisWeek', 'earlier'] as const) {
    if (buckets[key].length > 0) groups.push({ key, items: buckets[key] });
  }
  return groups;
}

/** A stable identity across kinds — chat, task and conversation ids live in
 * different tables and could in principle collide. */
export function homeItemKey(item: Pick<HomeItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}
