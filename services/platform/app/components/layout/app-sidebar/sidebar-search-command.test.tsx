import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// While the chat backend is rebuilt the palette runs an inline empty source
// (no Convex reads), so no data mocks are needed — only the router.
const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/app/hooks/use-convex-auth', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

function renderPalette() {
  return render(
    <SidebarProvider>
      <SidebarSearchCommand organizationId="org-1" />
    </SidebarProvider>,
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
      enMessages.dialogs.searchChat.placeholder,
      undefined,
      { timeout: 5000 },
    );
  };

  it('opens the palette with Ctrl+K and closes it with Escape', async () => {
    const { user } = renderPalette();

    expect(
      screen.queryByRole('combobox', {
        name: enMessages.dialogs.searchChat.placeholder,
      }),
    ).not.toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');

    const paletteInput = await screen.findByRole(
      'combobox',
      { name: enMessages.dialogs.searchChat.placeholder },
      { timeout: 5000 },
    );
    // The combobox enters the a11y tree as soon as the dialog mounts, but the
    // Radix open transition can lag a tick behind under saturated parallel
    // workers — poll for visibility rather than asserting it synchronously.
    await waitFor(() => expect(paletteInput).toBeVisible(), {
      timeout: 5000,
    });

    await user.keyboard('{Escape}');
    await waitForElementToBeRemoved(
      () =>
        screen.queryByRole('combobox', {
          name: enMessages.dialogs.searchChat.placeholder,
        }),
      { timeout: 5000 },
    );
  });

  // Chat search is offline while the chat backend is rebuilt: the inline
  // source answers every query with zero results, so the palette must land on
  // its "no results" state instead of a spinner or a crash.
  it('shows the empty state for any query while chat search is offline', async () => {
    const { user } = renderPalette();
    const input = await openSearch(user);
    await user.type(input, 'budget');
    expect(
      await screen.findByText(enMessages.dialogs.searchChat.noResults),
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
