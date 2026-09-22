import { cleanup } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { MobileBottomNav } from './mobile-bottom-nav';

// The two reads the Inbox tab depends on, mirroring the desktop rail.
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

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && 'count' in vars ? `${key}:${String(vars.count)}` : key,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: null, logoUrl: null }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-display-mode', () => ({
  useDisplayMode: () => ({ isStandalone: false, isMobileSafari: false }),
}));

vi.mock('@tale/ui/sheet', () => ({
  Sheet: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  inbox.hasInbox = true;
  unread.data = undefined;
  unreadCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The phone's Inbox tab carries the same unread chip as the desktop rail —
 *  a second nav surface, so it needs its own proof. */
describe('the mobile Inbox tab', () => {
  it('shows the unread count, with its meaning in the accessible name', () => {
    unread.data = 4;
    render(<MobileBottomNav organizationId="org-1" />);

    const tab = screen.getByRole('button', {
      name: /aria\.unreadConversations:4/,
    });
    expect(tab).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows no chip when the queue is clear', () => {
    unread.data = 0;
    render(<MobileBottomNav organizationId="org-1" />);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText(/unread/)).toBeNull();
  });

  it('shows no chip while the count is still loading', () => {
    unread.data = undefined;
    render(<MobileBottomNav organizationId="org-1" />);
    expect(screen.queryByText(/aria\.unreadConversations/)).toBeNull();
  });

  it('skips the count read while the tab itself is gated off', () => {
    inbox.hasInbox = false;
    render(<MobileBottomNav organizationId="org-1" />);
    expect(unreadCalls).toEqual([undefined]);
  });
});
