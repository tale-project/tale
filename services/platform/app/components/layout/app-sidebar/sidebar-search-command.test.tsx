import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { enMessages } from '@/tests/utils/messages';
import {
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from '@/tests/utils/render';

import { SidebarProvider, useSidebar } from './sidebar-context';
import { SidebarSearchCommand } from './sidebar-search-command';

const { mockNavigate, authState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  authState: { user: { userId: 'user-1' } as { userId: string } | undefined },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    pathname: '/dashboard/org-1/chat',
    search: {},
  }),
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => authState,
}));

vi.mock('./platform-search-source', () => ({
  createPlatformSearchSource: () => (query: string) => ({
    status: 'ready',
    results:
      query === 'Acquisition Atlas confidential'
        ? [{ id: 'chat-1', title: 'Private deal plan', data: { kind: 'chat' } }]
        : [],
  }),
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

function OpenChatsButton() {
  const { openSearch } = useSidebar();
  return (
    <button type="button" onClick={() => openSearch('chats')}>
      open-chats
    </button>
  );
}

function palette(organizationId = 'org-1') {
  return (
    <AbilityContext.Provider value={MEMBER_ABILITY}>
      <SidebarProvider>
        <OpenChatsButton />
        <SidebarSearchCommand organizationId={organizationId} />
      </SidebarProvider>
    </AbilityContext.Provider>
  );
}

function renderPalette() {
  return render(palette());
}

describe('SidebarSearchCommand', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    authState.user = { userId: 'user-1' };
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

  const openScope = async (
    user: ReturnType<typeof render>['user'],
    scope: string,
  ) => {
    if (scope === 'chats') {
      await user.click(screen.getByRole('button', { name: 'open-chats' }));
      return screen.findByPlaceholderText(
        enMessages.chat.searchPalette.placeholder,
      );
    }
    return openSearch(user);
  };

  it.each(['everything', 'chats'])(
    'isolates %s history across organizations and accounts',
    async (scope) => {
      const { user, rerender } = renderPalette();
      const input = await openScope(user, scope);
      await user.type(input, 'Acquisition Atlas confidential');
      await user.click(await screen.findByText('Private deal plan'));
      await waitFor(() =>
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
      );
      await openScope(user, scope);
      expect(
        await screen.findByText('Acquisition Atlas confidential'),
      ).toBeInTheDocument();

      rerender(palette('org-2'));
      await waitFor(() =>
        expect(
          screen.queryByText('Acquisition Atlas confidential'),
        ).not.toBeInTheDocument(),
      );
      expect(screen.queryByText('Private deal plan')).not.toBeInTheDocument();

      rerender(palette('org-1'));
      expect(
        await screen.findByText('Acquisition Atlas confidential'),
      ).toBeInTheDocument();
      authState.user = { userId: 'user-2' };
      rerender(palette());
      await waitFor(() =>
        expect(
          screen.queryByText('Acquisition Atlas confidential'),
        ).not.toBeInTheDocument(),
      );
      authState.user = { userId: 'user-1' };
      rerender(palette());
      expect(
        await screen.findByText('Acquisition Atlas confidential'),
      ).toBeInTheDocument();
      authState.user = undefined;
      rerender(palette());
      expect(
        screen.queryByText('Acquisition Atlas confidential'),
      ).not.toBeInTheDocument();
    },
  );

  it('keeps the two palette histories separate within the same identity', async () => {
    const { user } = renderPalette();
    await user.type(await openSearch(user), 'Acquisition Atlas confidential');
    await user.click(await screen.findByText('Private deal plan'));
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
    await openSearch(user);
    expect(
      await screen.findByText('Acquisition Atlas confidential'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: enMessages.dialogs.search.scopeChats,
      }),
    );
    expect(
      screen.queryByText('Acquisition Atlas confidential'),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: enMessages.dialogs.search.scopeEverything,
      }),
    );
    expect(
      await screen.findByText('Acquisition Atlas confidential'),
    ).toBeInTheDocument();
  });

  it.each(['everything', 'chats'])(
    'never imports legacy %s history',
    async (scope) => {
      for (const key of [
        'tale.platform.search.recentSearches.v1',
        'tale.platform.chat.searchPalette.recentSearches.v1',
      ]) {
        window.localStorage.setItem(
          key,
          JSON.stringify([
            {
              query: 'Acquisition Atlas confidential',
              title: 'Private deal plan',
              savedAt: 1,
            },
          ]),
        );
      }
      const { user } = renderPalette();
      await openScope(user, scope);
      expect(
        screen.queryByText('Acquisition Atlas confidential'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Private deal plan')).not.toBeInTheDocument();
    },
  );

  it('clears live input and result titles when identity changes', async () => {
    const { user, rerender } = renderPalette();
    await user.type(await openSearch(user), 'Acquisition Atlas confidential');
    await screen.findByText('Private deal plan');
    rerender(palette('org-2'));
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.queryByText('Private deal plan')).not.toBeInTheDocument();
  });

  it.each(['organization', 'account', 'sign-out'])(
    'keeps keyboard focus in the open palette after an %s change',
    async (change) => {
      const { user, rerender } = renderPalette();
      const opener = screen.getByRole('button', { name: 'open-chats' });
      await user.click(opener);
      await user.type(
        await screen.findByRole('combobox'),
        'Acquisition Atlas confidential',
      );
      await screen.findByText('Private deal plan');

      if (change === 'account') authState.user = { userId: 'user-2' };
      if (change === 'sign-out') authState.user = undefined;
      rerender(palette(change === 'organization' ? 'org-2' : 'org-1'));
      const input = screen.getByRole('combobox');
      expect(input).toHaveValue('');
      expect(screen.queryByText('Private deal plan')).not.toBeInTheDocument();
      // Keyboard input yields past the old FocusScope's delayed unmount
      // callback, which used to restore the surviving opener behind the modal.
      await user.keyboard('x');
      expect(input).toHaveFocus();
      expect(input).toHaveValue('x');
      await user.tab();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
        true,
      );
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(opener).toHaveFocus());
    },
  );

  it('disables history while the current account is unresolved', async () => {
    authState.user = undefined;
    const { user } = renderPalette();
    await user.type(await openSearch(user), 'Acquisition Atlas confidential');
    await user.click(await screen.findByText('Private deal plan'));
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
    await openSearch(user);
    expect(
      screen.queryByText('Acquisition Atlas confidential'),
    ).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

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

  it('switches scope in place without a second palette', async () => {
    const { user } = renderPalette();
    await user.click(screen.getByRole('button', { name: 'open-chats' }));

    expect(
      await screen.findByRole('combobox', {
        name: enMessages.chat.searchPalette.placeholder,
      }),
    ).toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), 'budget');

    await user.click(
      screen.getByRole('button', {
        name: enMessages.dialogs.search.scopeEverything,
        pressed: false,
      }),
    );

    expect(
      await screen.findByRole('combobox', {
        name: enMessages.dialogs.search.placeholder,
      }),
    ).toHaveValue('budget');
    expect(
      screen.getByRole('button', {
        name: enMessages.dialogs.search.scopeEverything,
        pressed: true,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: enMessages.dialogs.search.scopeChats,
        pressed: false,
      }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with the palette open', async () => {
      const { user, container } = renderPalette();
      await openSearch(user);
      await checkAccessibility(container);
    });
  });
});
