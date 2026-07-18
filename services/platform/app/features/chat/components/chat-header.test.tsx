import { describe, expect, it, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.json';
import { ChatHeader } from './chat-header';

// The sidebar owns search/history state now; the header only calls into it.
const { sidebarState } = vi.hoisted(() => ({
  sidebarState: {
    isExpanded: true,
    setExpanded: vi.fn(),
    toggleExpanded: vi.fn(),
    isMobileSheetOpen: false,
    setMobileSheetOpen: vi.fn(),
    isSearchOpen: false,
    setSearchOpen: vi.fn(),
  },
}));

vi.mock('@/app/components/layout/app-sidebar/sidebar-context', () => ({
  useSidebar: () => sidebarState,
}));

vi.mock('@/app/components/layout/adaptive-header', () => ({
  AdaptiveHeaderRoot: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="adaptive-header" className={className}>
      {children}
    </div>
  ),
}));

// The per-thread dialogs pull in Convex; the header only needs their mount
// points to exist.
vi.mock('./export-chat-dialog', () => ({
  ExportChatDialog: () => null,
}));
vi.mock('./share-chat-dialog', () => ({
  ShareChatDialog: () => null,
}));

describe('ChatHeader', () => {
  beforeEach(() => {
    sidebarState.setMobileSheetOpen.mockClear();
    sidebarState.setSearchOpen.mockClear();
    sidebarState.isMobileSheetOpen = false;
  });

  it('renders no desktop bar without a thread (sidebar owns nav/search)', () => {
    render(<ChatHeader organizationId="org-1" />);
    expect(
      screen.queryByLabelText(enMessages.chat.share.button),
    ).not.toBeInTheDocument();
  });

  it('shows the per-thread actions once a thread is open', () => {
    render(<ChatHeader organizationId="org-1" threadId="thread-1" />);
    // Desktop bar + mobile bar each render one — both surface the same label.
    expect(
      screen.getAllByLabelText(enMessages.chat.share.button).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText(enMessages.chat.moreActions).length,
    ).toBeGreaterThan(0);
  });

  it('mobile hamburger toggles the shared sidebar drawer', async () => {
    const { user } = render(<ChatHeader organizationId="org-1" />);
    await user.click(screen.getByLabelText(enMessages.chat.showHistory));
    expect(sidebarState.setMobileSheetOpen).toHaveBeenCalledWith(true);
  });

  it('mobile search button opens the shared palette', async () => {
    const { user } = render(<ChatHeader organizationId="org-1" />);
    await user.click(screen.getByLabelText(enMessages.chat.searchChat));
    expect(sidebarState.setSearchOpen).toHaveBeenCalledWith(true);
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ChatHeader organizationId="org-1" threadId="thread-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
