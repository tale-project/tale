import { describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/app/components/layout/app-sidebar/sidebar-context';
import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.yml';
import { ChatSearchTrigger } from './chat-search-trigger';

const setChatSearchOpen = vi.fn();

vi.mock(
  '@/app/components/layout/app-sidebar/sidebar-context',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/app/components/layout/app-sidebar/sidebar-context')
      >();
    return {
      ...actual,
      useOptionalSidebar: () => ({
        isMobileSheetOpen: false,
        setMobileSheetOpen: vi.fn(),
        isSearchOpen: false,
        setSearchOpen: vi.fn(),
        isChatSearchOpen: false,
        setChatSearchOpen,
      }),
    };
  },
);

describe('ChatSearchTrigger', () => {
  it('opens the chat-scoped palette when clicked', async () => {
    setChatSearchOpen.mockClear();
    const { user } = render(
      <SidebarProvider>
        <ChatSearchTrigger />
      </SidebarProvider>,
    );

    await user.click(
      screen.getByRole('button', {
        name: enMessages.chat.searchPalette.title,
      }),
    );
    expect(setChatSearchOpen).toHaveBeenCalledWith(true);
  });
});
