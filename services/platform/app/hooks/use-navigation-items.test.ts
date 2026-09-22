import { describe, expect, it, vi, beforeEach } from 'vitest';

import { renderHook } from '@/tests/utils/render';

// The two reads the Inbox entry depends on: whether the entry shows at all,
// and the unread count its chip carries.
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

function inboxItem() {
  const { result } = renderHook(() => useNavigationItems('org-1'));
  return result.current.primary.find(
    (item) => item.href === '/dashboard/org-1/conversations',
  );
}

beforeEach(() => {
  inbox.hasInbox = true;
  unread.data = undefined;
  unreadCalls.length = 0;
});

describe('the Inbox nav entry', () => {
  it('carries the unread count as its badge', () => {
    unread.data = 3;
    const item = inboxItem();
    expect(item?.badge).toBe(3);
    expect(item?.badgeLabel).toBe('aria.unreadConversations:3');
  });

  it('rests at zero while the count is still loading', () => {
    // `undefined` is "not read yet", not "none" — the tile must render bare
    // rather than flash a chip, and `badge: undefined` would drop the label.
    unread.data = undefined;
    expect(inboxItem()?.badge).toBe(0);
  });

  it('reports nothing to show when the queue is clear', () => {
    unread.data = 0;
    expect(inboxItem()?.badge).toBe(0);
  });

  it('skips the count read while the entry itself is hidden', () => {
    // No Inbox tile means no chip, so the request is wasted.
    inbox.hasInbox = false;
    expect(inboxItem()).toBeUndefined();
    expect(unreadCalls).toEqual([undefined]);
  });

  it('asks for the count scoped to the active organization', () => {
    inboxItem();
    expect(unreadCalls).toEqual(['org-1']);
  });
});
