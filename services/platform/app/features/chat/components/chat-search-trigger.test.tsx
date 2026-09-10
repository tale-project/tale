import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.yml';
import { ChatSearchTrigger } from './chat-search-trigger';

const openSearch = vi.fn();

vi.mock('@/app/components/layout/app-sidebar/sidebar-context', () => ({
  useOptionalSidebar: () => ({
    isMobileSheetOpen: false,
    setMobileSheetOpen: vi.fn(),
    isSearchOpen: false,
    setSearchOpen: vi.fn(),
    searchScope: 'everything' as const,
    setSearchScope: vi.fn(),
    openSearch,
  }),
}));

describe('ChatSearchTrigger', () => {
  beforeEach(() => {
    openSearch.mockClear();
  });

  it('opens the shared palette scoped to chats', async () => {
    const { user } = render(<ChatSearchTrigger />);
    await user.click(
      screen.getByRole('button', {
        name: enMessages.chat.searchPalette.title,
      }),
    );
    expect(openSearch).toHaveBeenCalledWith('chats');
  });
});
