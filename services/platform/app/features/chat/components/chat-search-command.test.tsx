import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/app/components/layout/app-sidebar/sidebar-context';
import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.yml';
import { ChatSearchCommand } from './chat-search-command';

const { mockNavigate, setSearchOpen } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  setSearchOpen: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/app/components/layout/app-sidebar/sidebar-context', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/components/layout/app-sidebar/sidebar-context')
  >('@/app/components/layout/app-sidebar/sidebar-context');
  return {
    ...actual,
    useSidebar: () => ({
      isMobileSheetOpen: false,
      setMobileSheetOpen: vi.fn(),
      isSearchOpen: false,
      setSearchOpen,
      isChatSearchOpen: true,
      setChatSearchOpen: vi.fn(),
    }),
  };
});

vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useChatQuery: () => ({ status: 'ready', data: [] }),
}));

describe('ChatSearchCommand', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    setSearchOpen.mockClear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('offers an escape hatch to the global palette', async () => {
    const { user } = render(
      <SidebarProvider>
        <ChatSearchCommand organizationId="org-1" />
      </SidebarProvider>,
    );

    expect(
      screen.getByRole('combobox', {
        name: enMessages.chat.searchPalette.placeholder,
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: new RegExp(enMessages.chat.searchPalette.searchEverywhere),
      }),
    );
    expect(setSearchOpen).toHaveBeenCalledWith(true);
  });
});
