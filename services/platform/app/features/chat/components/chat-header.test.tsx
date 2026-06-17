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
import { ChatHeader } from './chat-header';

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

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    isHistoryOpen: false,
    setIsHistoryOpen: vi.fn(),
    clearChatState: vi.fn(),
  }),
}));

vi.mock('./chat-history-sidebar', () => ({
  ChatHistorySidebar: () => <div data-testid="chat-history-sidebar" />,
}));

// Stub the threads source so the header's SearchCommand doesn't reach Convex
// (the source hook calls `useThreads`, which needs a ConvexProvider). The
// returned state is driven by `sourceRef` so tests can vary results/status.
vi.mock('./threads-search-source', () => ({
  createThreadsSearchSource: () => () => sourceRef.current,
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

vi.mock('../hooks/use-voice-output', () => ({
  useVoiceModeEffective: () => ({
    enabled: false,
    userDefault: false,
    source: 'default' as const,
  }),
}));

vi.mock('./thread-voice-output-switch', () => ({
  useThreadVoiceOutputCheckboxItem: () => null,
}));

describe('ChatHeader', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    sourceRef.current = { results: [], status: 'idle' };
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  // Two search toggles render (desktop + mobile) — open via the first.
  const openSearch = async (user: ReturnType<typeof render>['user']) => {
    await user.click(screen.getAllByLabelText(enMessages.chat.searchChat)[0]);
    return screen.findByPlaceholderText(
      enMessages.dialogs.searchChat.placeholder,
    );
  };

  it('opens the search palette and renders matching threads', async () => {
    sourceRef.current = {
      results: [{ id: 'thread-1', title: 'Budget kickoff', group: 'today' }],
      status: 'ready',
    };
    const { user } = render(<ChatHeader organizationId="org-1" />);
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
    const { user } = render(<ChatHeader organizationId="org-1" />);
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
    const { user } = render(<ChatHeader organizationId="org-1" />);
    const input = await openSearch(user);
    await user.type(input, 'x');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  // Migrated from the keyboard.spec.ts E2E "opens the command palette with the
  // keyboard shortcut and closes it with Escape". The header installs a
  // capturing `window` keydown listener (`(meta on mac | ctrl elsewhere) + K`)
  // that toggles the shared SearchCommand; Escape dismisses the Radix dialog it
  // is built on. Both are pure client-side UI (no router/backend), so they move
  // to the component tier. jsdom's userAgent has no "mac", so `isMod` resolves
  // to `e.ctrlKey` here — Ctrl+K is the correct combo (the E2E's cross-OS
  // `ControlOrMeta+k` maps to Control off-mac, exactly this branch).
  describe('command palette keyboard shortcut', () => {
    it('opens the palette with Ctrl+K and closes it with Escape', async () => {
      const { user } = render(<ChatHeader organizationId="org-1" />);

      // Palette is closed initially: its combobox input (aria-label = the
      // search placeholder) is not mounted.
      expect(
        screen.queryByRole('combobox', {
          name: enMessages.dialogs.searchChat.placeholder,
        }),
      ).not.toBeInTheDocument();

      // Fire the real shortcut; the listener is on `window` (capture phase), so
      // a document-level keypress reaches it.
      await user.keyboard('{Control>}k{/Control}');

      // Generous timeout: the Radix dialog mount is async and this whole suite
      // runs across saturated parallel workers, where the default 1s findBy
      // occasionally loses the race (the open itself is reliable).
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

      // Escape dismisses the Radix dialog the palette is built on.
      await user.keyboard('{Escape}');
      await waitForElementToBeRemoved(
        () =>
          screen.queryByRole('combobox', {
            name: enMessages.dialogs.searchChat.placeholder,
          }),
        { timeout: 5000 },
      );
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ChatHeader organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});
