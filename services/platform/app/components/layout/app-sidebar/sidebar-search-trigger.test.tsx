import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.yml';
import { SidebarProvider } from './sidebar-context';
import { SidebarSearchTrigger } from './sidebar-search-trigger';

const setSearchOpen = vi.fn();

vi.mock('./sidebar-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sidebar-context')>();
  return {
    ...actual,
    useOptionalSidebar: () => ({
      isMobileSheetOpen: false,
      setMobileSheetOpen: vi.fn(),
      isSearchOpen: false,
      setSearchOpen,
      isChatSearchOpen: false,
      setChatSearchOpen: vi.fn(),
    }),
  };
});

describe('SidebarSearchTrigger', () => {
  it('opens the palette when clicked', async () => {
    setSearchOpen.mockClear();
    const { user } = render(
      <SidebarProvider>
        <SidebarSearchTrigger />
      </SidebarProvider>,
    );

    await user.click(
      screen.getByRole('button', {
        name: enMessages.navigation.sidebar.searchGlobal,
      }),
    );
    expect(setSearchOpen).toHaveBeenCalledWith(true);
  });
});
