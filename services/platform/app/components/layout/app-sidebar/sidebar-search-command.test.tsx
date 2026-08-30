import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from '@/tests/utils/render';

import enMessages from '../../../../messages/en.yml';
import { SidebarProvider } from './sidebar-context';
import { SidebarSearchCommand } from './sidebar-search-command';

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    pathname: '/dashboard/org-1/chat',
    search: {},
  }),
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
  }),
}));

vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useChatQuery: () => ({ status: 'ready', data: [] }),
}));

const MEMBER_ABILITY = defineAbilityFor('member');

function renderPalette() {
  return render(
    <AbilityContext.Provider value={MEMBER_ABILITY}>
      <SidebarProvider>
        <SidebarSearchCommand organizationId="org-1" />
      </SidebarProvider>
    </AbilityContext.Provider>,
  );
}

describe('SidebarSearchCommand', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  // The palette is a shell-level surface with no inline trigger of its own —
  // its single global binding is the keyboard shortcut. jsdom's userAgent has
  // no "mac", so `isMod` resolves to `e.ctrlKey`; Ctrl+K is the correct combo.
  const openSearch = async (user: ReturnType<typeof render>['user']) => {
    await user.keyboard('{Control>}k{/Control}');
    return screen.findByPlaceholderText(
      enMessages.dialogs.search.placeholder,
      undefined,
      { timeout: 5000 },
    );
  };

  it('opens the palette with Ctrl+K and closes it with Escape', async () => {
    const { user } = renderPalette();

    expect(
      screen.queryByRole('combobox', {
        name: enMessages.dialogs.search.placeholder,
      }),
    ).not.toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');

    const paletteInput = await screen.findByRole(
      'combobox',
      { name: enMessages.dialogs.search.placeholder },
      { timeout: 5000 },
    );
    await waitFor(() => expect(paletteInput).toBeVisible(), {
      timeout: 5000,
    });

    await user.keyboard('{Escape}');
    await waitForElementToBeRemoved(
      () =>
        screen.queryByRole('combobox', {
          name: enMessages.dialogs.search.placeholder,
        }),
      { timeout: 5000 },
    );
  });

  it('shows the empty state when neither source has hits', async () => {
    const { user } = renderPalette();
    const input = await openSearch(user);
    await user.type(input, 'budget');
    expect(
      await screen.findByText(enMessages.dialogs.search.noResults),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with the palette open', async () => {
      const { user, container } = renderPalette();
      await openSearch(user);
      await checkAccessibility(container);
    });
  });
});
