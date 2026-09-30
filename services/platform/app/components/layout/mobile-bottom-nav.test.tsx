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

// The viewer below may author automations, so the Automations tab shows
// whatever the organization runs.
vi.mock(
  '@/app/features/automations/hooks/use-automations-availability',
  () => ({
    useAutomationsAvailability: () => ({
      isLoading: false,
      hasLiveOrgAutomation: false,
    }),
  }),
);

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
let automationSlug: string | undefined;
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
  useNavigate: () => navigate,
  useMatches: ({
    select,
  }: {
    select: (
      matches: { params: { automationSlug: string | undefined } }[],
    ) => boolean;
  }) => select([{ params: { automationSlug } }]),
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
  automationSlug = undefined;
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

  it('keeps automation detail navigation compact even through a click', async () => {
    // The canvas floats its own Deploy/Test actions right above the bar —
    // an expand-on-tap would crowd them the instant the tap that triggered
    // it lands, so this page's compact floor must survive a click too.
    automationSlug = 'example';
    const { user } = render(<MobileBottomNav organizationId="org-1" />);
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('data-compact');
    await user.click(screen.getByRole('button', { name: /^home/ }));
    expect(nav).toHaveAttribute('data-compact');
  });

  it('opens the Home list from the Home tab', async () => {
    const { user } = render(<MobileBottomNav organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: /^home/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/home',
      params: { id: 'org-1' },
    });
  });

  it('opens the automations list from the Automations tab', async () => {
    const { user } = render(<MobileBottomNav organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: /^automations/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations',
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
