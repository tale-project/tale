import { describe, expect, it, vi, beforeEach } from 'vitest';

import { renderHook } from '@/tests/utils/render';

// The two reads the Home entry's chip depends on: whether the organization
// has an inbox at all, and the unread count the chip carries.
const inbox = { hasInbox: true };
const unread: { data: number | undefined } = { data: undefined };
const unreadCalls: (string | undefined)[] = [];

vi.mock('@/app/features/conversations/hooks/use-inbox-availability', () => ({
  useInboxAvailability: () => inbox,
}));

vi.mock('@/app/features/conversations/hooks/queries', () => ({
  useUnreadConversationCount: (organizationId: string | undefined) => {
    unreadCalls.push(organizationId);
    return unread;
  },
}));

// `t(key, vars)` echoes the key with its count so an assertion can tell the
// badge's label apart from every other translated string.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && 'count' in vars ? `${key}:${String(vars.count)}` : key,
  }),
}));

vi.mock('@tale/ui/use-is-mac', () => ({ useIsMac: () => false }));

const { useNavigationItems } = await import('./use-navigation-items');

function items() {
  const { result } = renderHook(() => useNavigationItems('org-1'));
  return result.current;
}

function homeItem() {
  return items().primary.find((item) => item.label === 'home');
}

beforeEach(() => {
  inbox.hasInbox = true;
  unread.data = undefined;
  unreadCalls.length = 0;
});

describe('the rail', () => {
  it('lists the working sections, with Settings pinned to the foot', () => {
    const { primary, pinned } = items();
    expect(primary.map((item) => item.label)).toEqual([
      'home',
      'knowledge',
      'automations',
    ]);
    expect(pinned.map((item) => item.label)).toEqual(['userSettings']);
  });
});

describe('the Home nav entry', () => {
  it('opens the chat and lights up on every Home route', () => {
    const item = homeItem();
    expect(item?.to).toBe('/dashboard/$id/chat');
    for (const path of [
      '/dashboard/org-1/chat',
      '/dashboard/org-1/chat/thread-1',
      '/dashboard/org-1/projects',
      '/dashboard/org-1/projects/p-1/tasks/board',
      '/dashboard/org-1/tasks/t-1',
      '/dashboard/org-1/conversations/open',
    ]) {
      expect(item?.isActivePath?.(path), path).toBe(true);
    }
    for (const path of [
      '/dashboard/org-1/documents',
      '/dashboard/org-1/automations',
      '/dashboard/org-1/settings/account',
      // A shared-chat snapshot is a standalone reading page.
      '/dashboard/org-1/chat/shared/token-1',
    ]) {
      expect(item?.isActivePath?.(path), path).toBe(false);
    }
  });

  it('starts a fresh chat when clicked while already in Home', () => {
    expect(homeItem()?.reentrySearch).toEqual({ new: true });
  });

  it('carries the unread inbox count as its badge', () => {
    unread.data = 3;
    const item = homeItem();
    expect(item?.badge).toBe(3);
    expect(item?.badgeLabel).toBe('aria.unreadConversations:3');
  });

  it('rests at zero while the count is still loading', () => {
    // `undefined` is "not read yet", not "none" — the tile must render bare
    // rather than flash a chip, and `badge: undefined` would drop the label.
    unread.data = undefined;
    expect(homeItem()?.badge).toBe(0);
  });

  it('reports nothing to show when the queue is clear', () => {
    unread.data = 0;
    expect(homeItem()?.badge).toBe(0);
  });

  it('skips the count read when the organization has no inbox', () => {
    inbox.hasInbox = false;
    expect(homeItem()?.badge).toBe(0);
    expect(unreadCalls).toEqual([undefined]);
  });

  it('asks for the count scoped to the active organization', () => {
    homeItem();
    expect(unreadCalls).toEqual(['org-1']);
  });
});
