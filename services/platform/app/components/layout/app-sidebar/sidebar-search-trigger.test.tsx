import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.yml';
import { SidebarProvider } from './sidebar-context';
import { SidebarSearchTrigger } from './sidebar-search-trigger';

const openSearch = vi.fn();

vi.mock('./sidebar-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sidebar-context')>();
  return {
    ...actual,
    useOptionalSidebar: () => ({
      isMobileSheetOpen: false,
      setMobileSheetOpen: vi.fn(),
      isSearchOpen: false,
      setSearchOpen: vi.fn(),
      searchScope: 'everything' as const,
      setSearchScope: vi.fn(),
      openSearch,
    }),
  };
});

describe('SidebarSearchTrigger', () => {
  beforeEach(() => {
    openSearch.mockClear();
  });

  it('opens the palette on Everything when clicked', async () => {
    const { user } = render(
      <SidebarProvider>
        <SidebarSearchTrigger />
      </SidebarProvider>,
    );

    await user.click(
      screen.getByRole('button', {
        name: enMessages.navigation.sidebar.search,
      }),
    );
    expect(openSearch).toHaveBeenCalledWith('everything');
  });
});
