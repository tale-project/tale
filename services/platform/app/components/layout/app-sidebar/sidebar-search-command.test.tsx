import type { SearchSourceState } from '@tale/ui/search';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import {
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from '@/tests/utils/render';

import enMessages from '../../../../messages/en.json';
import { SidebarProvider } from './sidebar-context';
import { SidebarSearchCommand } from './sidebar-search-command';

// Shared, controllable mocks (hoisted so the vi.mock factories can close over
// them). `navigate` is asserted on selection; `sourceRef` lets each test drive
// what the threads SearchCommand source returns.
const { mockNavigate, sourceRef } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  sourceRef: {
    current: { results: [], status: 'idle' } as SearchSourceState,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// Stub the threads source so the palette doesn't reach Convex (the source hook
// calls `useThreads`, which needs a ConvexProvider). The returned state is
// driven by `sourceRef` so tests can vary results/status.
vi.mock('@/app/features/chat/components/threads-search-source', () => ({
  createThreadsSearchSource: () => () => sourceRef.current,
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
    sourceRef.current = { results: [], status: 'idle' };
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

  it('renders matching threads from the source', async () => {
    sourceRef.current = {
      results: [{ id: 'thread-1', title: 'Budget kickoff', group: 'today' }],
      status: 'ready',
    };
    const { user } = renderPalette();
    const input = await openSearch(user);
    // The threads source is mocked (ignores the query), so any text triggers it.
    await user.type(input, 'budget');
    // `toHaveTextContent` is robust to the highlight <mark> splitting the title.
    expect(await screen.findByRole('option')).toHaveTextContent(
      'Budget kickoff',
    );
  });

  it('navigates to the chosen thread on selection', async () => {
    sourceRef.current = {
      results: [{ id: 'thread-42', title: 'Roadmap review', group: 'today' }],
      status: 'ready',
    };
    const { user } = renderPalette();
    const input = await openSearch(user);
    await user.type(input, 'road');
    await user.click(await screen.findByRole('option'));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { id: 'org-1', threadId: 'thread-42' },
      }),
    );
  });

  it('surfaces the error state when the threads source fails', async () => {
    sourceRef.current = {
      results: [],
      status: 'error',
      error: new Error('boom'),
    };
    const { user } = renderPalette();
    const input = await openSearch(user);
    await user.type(input, 'x');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with the palette open', async () => {
      const { user, container } = renderPalette();
      await openSearch(user);
      await checkAccessibility(container);
    });
  });
});
