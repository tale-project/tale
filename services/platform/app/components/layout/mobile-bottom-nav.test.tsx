import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { MobileBottomNav } from './mobile-bottom-nav';

// The two reads the Home tab's chip depends on, mirroring the desktop rail.
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

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
  useNavigate: () => navigate,
}));

vi.mock('@tale/ui/use-is-mac', () => ({ useIsMac: () => false }));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: null, logoUrl: null }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-display-mode', () => ({
  useDisplayMode: () => ({ isStandalone: false, isMobileSafari: false }),
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

describe('the mobile tab bar', () => {
  it('lists the same sections as the rail, Settings included', () => {
    render(<MobileBottomNav organizationId="org-1" />);
    const tabs = screen.getAllByRole('button').map((tab) => tab.textContent);
    expect(tabs).toEqual(['home', 'knowledge', 'automations', 'userSettings']);
  });

  it('opens the Home list from the Home tab', async () => {
    const { user } = render(<MobileBottomNav organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: /^home/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/home',
      params: { id: 'org-1' },
    });
  });
});

/** The phone's Home tab carries the same unread chip as the desktop rail —
 *  a second nav surface, so it needs its own proof. */
describe('the mobile Home tab', () => {
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

  it('skips the count read when the organization has no inbox', () => {
    inbox.hasInbox = false;
    render(<MobileBottomNav organizationId="org-1" />);
    expect(unreadCalls).toEqual([undefined]);
  });
});
