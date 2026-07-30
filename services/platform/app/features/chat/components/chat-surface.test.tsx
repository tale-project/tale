// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

const navigateMock = vi.hoisted(() => vi.fn());
// Whether the rendered viewer could open Settings → AI providers; the
// provider-setup guidance branches on it.
const canManageProvidersMock = vi.hoisted(() => ({ value: false }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigateMock,
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => canManageProvidersMock.value,
    cannot: () => !canManageProvidersMock.value,
  }),
}));

// The seam states these tests steer — threads, the model listing, and the
// send write. The defaults mirror the provider-less test environment
// (everything unavailable); suites override per scenario and the shared
// afterEach below restores the defaults.
vi.mock('@/app/features/governance/components/data-notice-footer', () => ({
  DataNoticeFooter: () => null,
}));

// The draft key wants the signed-in user's id; this harness has no Convex
// auth provider, so the hook answers "still loading" and the key falls back
// to the org-scoped form.
vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ status: 'loading', data: undefined }),
}));

// The budget banner's Convex read has no client in this harness; a null
// status keeps the real component mounted but rendering nothing.
vi.mock(
  '@/app/features/settings/governance/hooks/queries',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('@/app/features/settings/governance/hooks/queries')
      >();
    return {
      ...original,
      useMyBudgetStatus: vi.fn(() => ({ data: null })),
    };
  },
);

vi.mock('../hooks/use-thread-view', () => ({
  useThreadView: vi.fn(() => ({
    status: 'unavailable' as const,
    items: [],
    generation: null,
    streamingMessageId: undefined,
    pendingConsumed: false,
  })),
}));

vi.mock('../data/chat-backend', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../data/chat-backend')>();
  return {
    ...original,
    useComposerModels: vi.fn(() => ({ status: 'unavailable' as const })),
    useChatThreads: vi.fn(() => ({ status: 'unavailable' as const })),
    useChatThread: vi.fn(() => ({ status: 'unavailable' as const })),
    useChatGeneration: vi.fn(() => ({ status: 'unavailable' as const })),
    useChatSend: vi.fn(() => ({
      available: false,
      start: () => Promise.reject(new Error('unavailable')),
      stop: () => Promise.resolve(),
    })),
    useChatModelPreference: vi.fn(() => ({
      preference: { status: 'unavailable' as const },
      save: vi.fn(),
    })),
  };
});

import {
  useChatGeneration,
  useChatModelPreference,
  useChatSend,
  useChatThread,
  useChatThreads,
  useComposerModels,
} from '../data/chat-backend';
import { useThreadView } from '../hooks/use-thread-view';
import { ChatSurface } from './chat-surface';

afterEach(() => {
  navigateMock.mockReset();
  canManageProvidersMock.value = false;
  // Drafts persist per conversation in localStorage — never across tests.
  localStorage.clear();
  vi.mocked(useComposerModels).mockImplementation(() => ({
    status: 'unavailable' as const,
  }));
  vi.mocked(useChatThreads).mockImplementation(() => ({
    status: 'unavailable' as const,
  }));
  vi.mocked(useChatThread).mockImplementation(() => ({
    status: 'unavailable' as const,
  }));
  vi.mocked(useThreadView).mockImplementation(() => ({
    status: 'unavailable' as const,
    items: [],
    generation: null,
    streamingMessageId: undefined,
    pendingConsumed: false,
  }));
  vi.mocked(useChatGeneration).mockImplementation(() => ({
    status: 'unavailable' as const,
  }));
  vi.mocked(useChatSend).mockImplementation(() => ({
    available: false,
    start: () => Promise.reject(new Error('unavailable')),
    stop: () => Promise.resolve(),
  }));
  vi.mocked(useChatModelPreference).mockImplementation(() => ({
    preference: { status: 'unavailable' as const },
    save: vi.fn(),
  }));
});

/**
 * The chat Convex functions are not deployed yet, so the seam reports
 * `unavailable` for every read. These tests pin what the screen does with
 * that answer — it must say so, and it must not present an empty
 * conversation as a loaded one.
 */
/** Open the composer's one picker, then one of its section submenus. */
async function openSection(
  user: ReturnType<typeof render>['user'],
  name: RegExp,
) {
  await user.click(
    screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
  );
  await user.click(screen.getByRole('menuitem', { name }));
}

describe('ChatSurface while the chat backend is unavailable', () => {
  it('states that chat is not connected instead of showing an empty thread', () => {
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: "Chat isn't connected yet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'What are we working on?' }),
    ).toBeNull();
  });

  it('keeps the composer visible but refuses to take a message it would drop', () => {
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeDisabled();
  });

  it('passes an axe audit', async () => {
    const { container } = render(<ChatSurface organizationId="org-1" />);
    await waitFor(() => checkAccessibility(container));
  });
});

/**
 * The model listing ANSWERED and is empty: the org holds no active provider
 * credential. The index must guide to provider settings instead of blaming
 * the connection — an empty catalog is a setup gap, not an outage.
 */
describe('ChatSurface when the model listing answers and is empty', () => {
  beforeEach(() => {
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
  });

  it('guides an admin to provider settings instead of claiming a connection problem', () => {
    canManageProvidersMock.value = true;
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'No AI provider connected yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Connect a provider under Settings → AI providers to start chatting.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: "Chat isn't connected yet" }),
    ).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Open AI providers' }),
    ).toHaveAttribute('href', '/dashboard/$id/settings/providers');
  });

  it('tells a member to ask their admin, without a settings link they could not open', () => {
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'No AI provider connected yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ask your workspace admin to connect an AI provider.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Open AI providers' }),
    ).toBeNull();
  });

  it('keeps the connection message on an open thread — a missing conversation is not a catalog gap', () => {
    render(<ChatSurface organizationId="org-1" threadId="t1" />);

    expect(
      screen.getByRole('heading', { name: "Chat isn't connected yet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'No AI provider connected yet' }),
    ).toBeNull();
  });

  it('passes an axe audit', async () => {
    const { container } = render(<ChatSurface organizationId="org-1" />);
    await waitFor(() => checkAccessibility(container));
  });
});

/**
 * The reads are merely still LOADING (a navigation just mounted the surface):
 * the composer must render ready — placeholder shown, text accepted — with
 * only SEND held back, and an open thread masks its conversation in place
 * instead of blanking the column.
 */
describe('ChatSurface while its reads are still loading', () => {
  beforeEach(() => {
    vi.mocked(useChatThreads).mockReturnValue({ status: 'loading' as const });
    vi.mocked(useThreadView).mockReturnValue({
      status: 'loading',
      items: [],
      generation: null,
      streamingMessageId: undefined,
      pendingConsumed: false,
    });
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready' as const,
      data: {
        models: [
          {
            id: 'deepseek-chat',
            label: 'deepseek-chat',
            providerSlug: 'deepseek',
            credential: { authMethod: 'api-key' as const },
          },
        ],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: () =>
        Promise.resolve({
          threadId: 't-new',
          outcome: Promise.resolve({ status: 'completed' as const }),
        }),
      stop: () => Promise.resolve(),
    });
  });

  it('takes text immediately and holds only the send button', async () => {
    const { user } = render(<ChatSurface organizationId="org-1" />);

    const input = screen.getByRole('textbox', { name: 'Message input' });
    expect(input).toBeEnabled();
    expect(screen.getByText(/ask about your documents/i)).toBeInTheDocument();

    await user.type(input, 'draft while the list loads');
    expect(input).toHaveValue('draft while the list loads');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('masks the open conversation in place instead of blanking the column', () => {
    render(<ChatSurface organizationId="org-1" threadId="t1" />);

    expect(
      screen.getByRole('status', { name: /loading conversation/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: "Chat isn't connected yet" }),
    ).toBeNull();
  });

  it('enables send once the reads settle', () => {
    vi.mocked(useChatThreads).mockReturnValue({
      status: 'ready' as const,
      data: [],
    });
    render(<ChatSurface organizationId="org-1" />);

    // Still disabled only because the field is empty — not because of a
    // loading read.
    const input = screen.getByRole('textbox', { name: 'Message input' });
    expect(input).toBeEnabled();
  });
});

/**
 * The backend is live: threads answer, the listing carries a model, sending
 * is available. The index welcomes instead of alarming, the default model is
 * seeded so sending needs no menu visit, and a send starts the turn and
 * navigates into the thread it created.
 */
describe('ChatSurface when the backend is live and a model is listed', () => {
  const MODEL = {
    id: 'deepseek-chat',
    label: 'deepseek-chat',
    providerSlug: 'deepseek',
    credential: { authMethod: 'api-key' as const },
  };

  const SECOND_MODEL = {
    id: 'deepseek-reasoner',
    label: 'deepseek-reasoner',
    providerSlug: 'deepseek',
    credential: { authMethod: 'api-key' as const },
  };

  const start = vi.fn();

  beforeEach(() => {
    start.mockReset();
    vi.mocked(useChatThreads).mockReturnValue({ status: 'ready', data: [] });
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start,
      stop: vi.fn(() => Promise.resolve()),
    });
  });

  it('welcomes on the index instead of claiming a connection problem', () => {
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'What are we working on?' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: "Chat isn't connected yet" }),
    ).toBeNull();
  });

  it('fills the composer from a starter instead of firing it as a message', async () => {
    const { user } = render(<ChatSurface organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', {
        name: 'Help me write a clear, professional email',
      }),
    );

    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveValue(
      'Help me write a clear, professional email',
    );
  });

  it('seeds the default model and keeps the composer usable', () => {
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toHaveTextContent('deepseek-chat');
  });

  it("seeds the user's sticky pick over the listing default", () => {
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL, SECOND_MODEL],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatModelPreference).mockReturnValue({
      preference: { status: 'ready', data: SECOND_MODEL.id },
      save: vi.fn(),
    });

    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toHaveTextContent('deepseek-reasoner');
  });

  it('saves an explicit model pick, and only an explicit one', async () => {
    const save = vi.fn();
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL, SECOND_MODEL],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatModelPreference).mockReturnValue({
      preference: { status: 'ready', data: undefined },
      save,
    });

    const { user } = render(<ChatSurface organizationId="org-1" />);

    // Seeding picked MODEL by default — that must not have been saved.
    expect(save).not.toHaveBeenCalled();

    await openSection(user, /^Model/);
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: (name: string) => name.startsWith('deepseek-reasoner'),
      }),
    );

    expect(save).toHaveBeenCalledWith('deepseek-reasoner');
  });

  it('starts the turn and navigates into the thread it created', async () => {
    start.mockResolvedValue({
      threadId: 't-1',
      outcome: Promise.resolve({ status: 'completed' as const }),
    });
    const { user } = render(<ChatSurface organizationId="org-1" />);

    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'Hello there',
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        text: 'Hello there',
        modelId: 'deepseek-chat',
        providerSlug: 'deepseek',
      });
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/dashboard/$id/chat/$threadId',
        params: { id: 'org-1', threadId: 't-1' },
      });
    });
  });

  it('offers a working Stop for any in-flight generation', async () => {
    const stop = vi.fn(() => Promise.resolve());
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: vi.fn(),
      stop,
    });
    vi.mocked(useChatGeneration).mockReturnValue({
      status: 'ready',
      data: { status: 'streaming' },
    });
    vi.mocked(useThreadView).mockReturnValue({
      status: 'ready',
      items: [],
      generation: null,
      streamingMessageId: undefined,
      pendingConsumed: false,
    });

    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="t-1" />,
    );

    const stopButton = await screen.findByRole('button', {
      name: 'Stop generating',
    });
    await user.click(stopButton);
    expect(stop).toHaveBeenCalledWith('t-1');
  });

  it('passes an axe audit', async () => {
    const { container } = render(<ChatSurface organizationId="org-1" />);
    await waitFor(() => checkAccessibility(container));
  });
});

/**
 * The thread-list panel folds away from a toggle in the conversation column
 * and the choice persists per org — the same key the index.html pre-hydration
 * script reads to decide whether the served boot shell shows the panel
 * skeleton, so these tests also pin the storage contract and the live
 * `boot-chat-panel-open` mirror on <html>.
 */
describe('ChatSurface history panel toggle', () => {
  beforeEach(() => {
    vi.mocked(useChatThreads).mockReturnValue({ status: 'ready', data: [] });
  });

  afterEach(() => {
    window.localStorage.removeItem('chat-history-panel-open-org-1');
    document.documentElement.classList.remove('boot-chat-panel-open');
  });

  it('collapses the panel, flips the toggle, and persists the choice', async () => {
    const { user } = render(<ChatSurface organizationId="org-1" />);

    const panel = screen.getByRole('navigation', { name: 'Chats' });
    expect(panel).not.toHaveClass('w-0');
    expect(document.documentElement).toHaveClass('boot-chat-panel-open');

    const toggle = screen.getByRole('button', { name: 'Hide chats' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'chat-sub-panel');
    await user.click(toggle);

    // The panel folds to zero width but keeps its landmark; its content is
    // taken out of the accessibility tree and the tab order.
    expect(panel).toHaveClass('w-0');
    expect(
      // oxlint-disable-next-line testing-library/no-node-access -- the inert wrapper is structural, not a queryable role
      panel.querySelector('[inert]'),
    ).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Show chats' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.documentElement).not.toHaveClass('boot-chat-panel-open');
    expect(window.localStorage.getItem('chat-history-panel-open-org-1')).toBe(
      'false',
    );
  });

  it('mounts collapsed when the persisted state says so', () => {
    window.localStorage.setItem('chat-history-panel-open-org-1', 'false');
    render(<ChatSurface organizationId="org-1" />);

    expect(screen.getByRole('navigation', { name: 'Chats' })).toHaveClass(
      'w-0',
    );
    expect(
      screen.getByRole('button', { name: 'Show chats' }),
    ).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass('boot-chat-panel-open');
  });

  it('passes an axe audit while collapsed', async () => {
    window.localStorage.setItem('chat-history-panel-open-org-1', 'false');
    const { container } = render(<ChatSurface organizationId="org-1" />);
    await waitFor(() => checkAccessibility(container));
  });
});

describe('ChatSurface on a dead thread link', () => {
  beforeEach(() => {
    vi.mocked(useChatThreads).mockReturnValue({ status: 'ready', data: [] });
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [
          {
            id: 'deepseek-chat',
            label: 'deepseek-chat',
            providerSlug: 'deepseek',
            credential: { authMethod: 'api-key' as const },
          },
        ],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: vi.fn(),
      stop: vi.fn(() => Promise.resolve()),
    });
    vi.mocked(useThreadView).mockReturnValue({
      status: 'ready',
      items: [],
      generation: null,
      streamingMessageId: undefined,
      pendingConsumed: false,
    });
    // The open-thread read answers null: deleted, foreign, or revoked.
    vi.mocked(useChatThread).mockReturnValue({ status: 'ready', data: null });
  });

  it('shows an explicit not-found state instead of a live empty chat', () => {
    render(<ChatSurface organizationId="org-1" threadId="thread-gone" />);

    expect(screen.getByText('This chat is not available.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New chat' }),
    ).toBeInTheDocument();
    // No composer: typing into a dead thread only earns a post-hoc refusal.
    expect(screen.queryByRole('textbox', { name: 'Message input' })).toBeNull();
  });

  it('routes the way out to the chat index', async () => {
    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="thread-gone" />,
    );

    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/dashboard/$id/chat' }),
    );
  });
});

describe('ChatSurface on an archived thread', () => {
  const ARCHIVED_THREAD = {
    id: 'thread-archived',
    title: 'Old plans',
    kind: 'direct' as const,
    archived: true,
    createdAt: 1,
    updatedAt: 2,
    generating: false,
    viewerIsOwner: true,
  };

  beforeEach(() => {
    vi.mocked(useChatThreads).mockReturnValue({
      status: 'ready',
      data: [ARCHIVED_THREAD],
    });
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [
          {
            id: 'deepseek-chat',
            label: 'deepseek-chat',
            providerSlug: 'deepseek',
            credential: { authMethod: 'api-key' as const },
          },
        ],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: vi.fn(),
      stop: vi.fn(() => Promise.resolve()),
    });
    vi.mocked(useThreadView).mockReturnValue({
      status: 'ready',
      items: [],
      generation: null,
      streamingMessageId: undefined,
      pendingConsumed: false,
    });
    vi.mocked(useChatThread).mockReturnValue({
      status: 'ready',
      data: ARCHIVED_THREAD,
    });
  });

  it('replaces the composer with the archived banner and its unarchive action', () => {
    render(<ChatSurface organizationId="org-1" threadId="thread-archived" />);

    expect(
      screen.getByText('This conversation was archived'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Unarchive' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message input' })).toBeNull();
  });
});
