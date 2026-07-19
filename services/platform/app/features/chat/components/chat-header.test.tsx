import { describe, expect, it, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.json';
import { ChatHeader } from './chat-header';

// The sidebar owns search/drawer state; the chat layout owns the sub-panel
// visibility. The header only calls into them.
const { sidebarState, chatLayoutState } = vi.hoisted(() => ({
  sidebarState: {
    isMobileSheetOpen: false,
    setMobileSheetOpen: vi.fn(),
    isSearchOpen: false,
    setSearchOpen: vi.fn(),
  },
  chatLayoutState: {
    isHistoryPanelOpen: true,
    toggleHistoryPanel: vi.fn(),
  },
}));

vi.mock('@/app/components/layout/app-sidebar/sidebar-context', () => ({
  useSidebar: () => sidebarState,
}));

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => chatLayoutState,
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
    chatLayoutState.toggleHistoryPanel.mockClear();
    chatLayoutState.isHistoryPanelOpen = true;
  });

  it('without a thread: only the panel toggle, no per-thread actions', () => {
    render(<ChatHeader organizationId="org-1" />);
    expect(
      screen.queryByLabelText(enMessages.chat.share.button),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(enMessages.chat.hideHistory),
    ).toBeInTheDocument();
  });

  it('the panel toggle flips the persisted sub-panel visibility', async () => {
    const { user } = render(<ChatHeader organizationId="org-1" />);
    const toggle = screen.getByLabelText(enMessages.chat.hideHistory);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'chat-sub-panel');
    await user.click(toggle);
    expect(chatLayoutState.toggleHistoryPanel).toHaveBeenCalledTimes(1);
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
      // The toggle's aria-controls points at the chat sub-panel, which lives
      // beside the header in the route layout — give the isolated render the
      // same id so the reference resolves for axe.
      const { container } = render(
        <>
          <ChatHeader organizationId="org-1" threadId="thread-1" />
          <div id="chat-sub-panel" />
        </>,
      );
      await checkAccessibility(container);
    });
  });
});
