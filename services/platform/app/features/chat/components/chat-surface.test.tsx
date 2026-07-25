// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

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
vi.mock('../data/chat-backend', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../data/chat-backend')>();
  return {
    ...original,
    useComposerModels: vi.fn(() => ({ status: 'unavailable' as const })),
    useComposerCapabilities: vi.fn(() => ({
      status: 'unavailable' as const,
    })),
    useChatThreads: vi.fn(() => ({ status: 'unavailable' as const })),
    useChatMessages: vi.fn(() => ({ status: 'unavailable' as const })),
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
    useThreadCapabilities: vi.fn(() => ({
      available: false,
      save: vi.fn(),
    })),
  };
});

import {
  useChatGeneration,
  useChatMessages,
  useChatModelPreference,
  useChatSend,
  useChatThreads,
  useComposerCapabilities,
  useComposerModels,
  useThreadCapabilities,
} from '../data/chat-backend';
import { ChatSurface } from './chat-surface';

afterEach(() => {
  navigateMock.mockReset();
  canManageProvidersMock.value = false;
  vi.mocked(useComposerModels).mockImplementation(() => ({
    status: 'unavailable' as const,
  }));
  vi.mocked(useChatThreads).mockImplementation(() => ({
    status: 'unavailable' as const,
  }));
  vi.mocked(useChatMessages).mockImplementation(() => ({
    status: 'unavailable' as const,
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
  vi.mocked(useComposerCapabilities).mockImplementation(() => ({
    status: 'unavailable' as const,
  }));
  vi.mocked(useThreadCapabilities).mockImplementation(() => ({
    available: false,
    save: vi.fn(),
  }));
});

/**
 * The chat Convex functions are not deployed yet, so the seam reports
 * `unavailable` for every read. These tests pin what the screen does with
 * that answer — it must say so, and it must not present an empty
 * conversation as a loaded one.
 */
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

  it('renders no Canvas, because no thread has a mode to show', () => {
    render(<ChatSurface organizationId="org-1" threadId="t1" />);

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Canvas' })).toBeNull();
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
      data: { models: [], externalAgents: [] },
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
      data: { models: [MODEL], externalAgents: [] },
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

  it('seeds the default model and keeps the composer usable', () => {
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toHaveTextContent('deepseek-chat');
  });

  it("seeds the user's sticky pick over the listing default", () => {
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: { models: [MODEL, SECOND_MODEL], externalAgents: [] },
    });
    vi.mocked(useChatModelPreference).mockReturnValue({
      preference: { status: 'ready', data: SECOND_MODEL.id },
      save: vi.fn(),
    });

    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toHaveTextContent('deepseek-reasoner');
  });

  it('saves an explicit model pick, and only an explicit one', async () => {
    const save = vi.fn();
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: { models: [MODEL, SECOND_MODEL], externalAgents: [] },
    });
    vi.mocked(useChatModelPreference).mockReturnValue({
      preference: { status: 'ready', data: undefined },
      save,
    });

    const { user } = render(<ChatSurface organizationId="org-1" />);

    // Seeding picked MODEL by default — that must not have been saved.
    expect(save).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Select model' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'deepseek-reasoner' }),
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
        agentKind: 'platform',
        modelId: 'deepseek-chat',
        sandbox: false,
      });
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/dashboard/$id/chat/$threadId',
        params: { id: 'org-1', threadId: 't-1' },
      });
    });
  });

  it('passes an axe audit', async () => {
    const { container } = render(<ChatSurface organizationId="org-1" />);
    await waitFor(() => checkAccessibility(container));
  });
});

/**
 * A sandbox thread keeps its external agent for life. Opening one must show
 * that agent — not reset to the platform default — or the next turn would
 * silently run on the wrong lane. The agent picker locks; switching is a new
 * chat.
 */
describe('ChatSurface on an open sandbox thread', () => {
  const MODEL = {
    id: 'deepseek-chat',
    label: 'deepseek-chat',
    providerSlug: 'deepseek',
    credential: { authMethod: 'api-key' as const },
  };

  beforeEach(() => {
    vi.mocked(useChatThreads).mockReturnValue({
      status: 'ready',
      data: [
        {
          id: 't-sbx',
          kind: 'sandbox',
          harness: 'claude-code',
          archived: false,
          updatedAt: 1,
          generating: false,
        },
      ],
    });
    vi.mocked(useChatMessages).mockReturnValue({ status: 'ready', data: [] });
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL],
        externalAgents: [{ harness: 'claude-code', label: 'Claude Code' }],
      },
    });
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: vi.fn(),
      stop: vi.fn(() => Promise.resolve()),
    });
  });

  it('follows the thread onto its external agent instead of the platform default', async () => {
    render(<ChatSurface organizationId="org-1" threadId="t-sbx" />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Select agent' }),
      ).toHaveTextContent('Claude Code');
    });
    // The external lane keeps a model picker: a managed harness runs a
    // directly-served org model, seeded exactly like the platform lane.
    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toHaveTextContent('deepseek-chat');
  });

  it('sends the external turn with its harness and the direct-served model', async () => {
    const start = vi.fn().mockResolvedValue({
      threadId: 't-sbx',
      outcome: Promise.resolve({ status: 'completed' as const }),
    });
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start,
      stop: vi.fn(() => Promise.resolve()),
    });

    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="t-sbx" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Select agent' }),
      ).toHaveTextContent('Claude Code');
    });
    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'Fix the bug',
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        threadId: 't-sbx',
        text: 'Fix the bug',
        agentKind: 'external',
        modelId: 'deepseek-chat',
        harness: 'claude-code',
        sandbox: true,
      });
    });
  });

  it('locks the agent picker — the thread cannot change agents', async () => {
    render(<ChatSurface organizationId="org-1" threadId="t-sbx" />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Select agent' }),
      ).toHaveTextContent('Claude Code');
    });
    expect(screen.getByRole('button', { name: 'Select agent' })).toBeDisabled();
  });

  it('offers a working Stop while an external turn is in flight', async () => {
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

    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="t-sbx" />,
    );

    const stopButton = await screen.findByRole('button', {
      name: 'Stop generating',
    });
    await user.click(stopButton);
    expect(stop).toHaveBeenCalledWith('t-sbx');
  });
});

/**
 * The conversation's capability assembly lives on the thread row. The surface
 * remounts between the index and `$threadId`, so the menu must re-hydrate
 * from the row (or it resets to empty right after the first send), and a
 * toggle made mid-conversation must persist through the seam (or the next
 * turn silently runs with the stale set frozen at creation).
 */
describe('ChatSurface capability assembly on an open sandbox thread', () => {
  const MODEL = {
    id: 'deepseek-chat',
    label: 'deepseek-chat',
    providerSlug: 'deepseek',
    credential: { authMethod: 'api-key' as const },
  };

  beforeEach(() => {
    vi.mocked(useChatThreads).mockReturnValue({
      status: 'ready',
      data: [
        {
          id: 't-sbx',
          kind: 'sandbox',
          harness: 'claude-code',
          capabilities: { skills: [], connectors: ['github'] },
          archived: false,
          updatedAt: 1,
          generating: false,
        },
      ],
    });
    vi.mocked(useChatMessages).mockReturnValue({ status: 'ready', data: [] });
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL],
        externalAgents: [{ harness: 'claude-code', label: 'Claude Code' }],
      },
    });
    vi.mocked(useComposerCapabilities).mockReturnValue({
      status: 'ready',
      data: {
        skills: [],
        connectors: [
          { slug: 'github', label: 'GitHub' },
          { slug: 'tavily', label: 'Tavily' },
        ],
      },
    });
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: vi.fn(),
      stop: vi.fn(() => Promise.resolve()),
    });
  });

  it('re-hydrates the menu from the thread row instead of resetting to empty', async () => {
    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="t-sbx" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Capabilities' }),
      ).toHaveTextContent('Capabilities (1)');
    });
    await user.click(screen.getByRole('button', { name: 'Capabilities' }));
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'GitHub' }),
    ).toBeChecked();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Tavily' }),
    ).not.toBeChecked();
  });

  it('persists a toggle made mid-conversation onto the thread', async () => {
    const save = vi.fn();
    vi.mocked(useThreadCapabilities).mockReturnValue({
      available: true,
      save,
    });

    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="t-sbx" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Capabilities' }),
      ).toHaveTextContent('Capabilities (1)');
    });
    await user.click(screen.getByRole('button', { name: 'Capabilities' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Tavily' }));

    expect(save).toHaveBeenCalledWith('t-sbx', {
      skills: [],
      connectors: ['github', 'tavily'],
    });
  });
});
