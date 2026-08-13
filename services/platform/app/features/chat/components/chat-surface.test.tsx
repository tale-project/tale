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
      // The picker-accept derivation reads the org upload policy through a
      // Convex query none of these tests provide: policy off = full family.
      useUploadPolicy: vi.fn(() => ({
        maxFileSize: Infinity,
        allowedTypes: [],
        allowedExtensions: [],
        blockedExtensions: [],
        documentMaxFileSize: Infinity,
        policyEnabled: false,
      })),
    };
  },
);

// The image-attachment upload lane talks to Convex (upload handoff, policy
// read, file-metadata registration) — none of which exists here. An inert
// stand-in keeps the composer's attach surface mounted with nothing staged.
vi.mock('@/app/features/shared/files/use-convex-file-upload', () => ({
  useConvexFileUpload: () => ({
    attachments: [],
    setAttachments: vi.fn(),
    uploadingFiles: [],
    isUploading: false,
    uploadFiles: vi.fn(),
    cancelUpload: vi.fn(),
    removeAttachment: vi.fn(),
    retryAttachmentTranscription: vi.fn(),
    clearAttachments: vi.fn(() => []),
  }),
}));
// Mutable so a test can put a staged clip mid-transcription and assert the
// send gate; reset in the root beforeEach.
const transcriptionState = {
  statusMap: new Map<string, { status?: string }>(),
  isTranscribing: false,
  isQueryLoading: false,
};
vi.mock('../hooks/use-file-transcription-status', () => ({
  useFileTranscriptionStatus: () => transcriptionState,
}));
// Mirrors the transcription mock for staged documents: mutable so a test can
// stage a still-indexing file and assert the send gate.
const indexingState = {
  statusMap: new Map<string, { status?: string }>(),
  isIndexing: false,
  isQueryLoading: false,
};
vi.mock('../hooks/use-file-indexing-status', () => ({
  useFileIndexingStatus: () => indexingState,
}));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));
// Video-link jobs ride a Convex subscription this harness lacks. Mutable so
// a test can stage a failed chip and assert the send gate.
const videoLinksState = {
  jobs: [] as never[],
  isAnyProcessing: false,
  hasFailedJobs: false,
  ingestUrlsFromText: vi.fn(() => Promise.resolve(0)),
  cancelJob: vi.fn(() => Promise.resolve()),
  retryJob: vi.fn(() => Promise.resolve()),
  markJobsSent: vi.fn(),
  unmarkJobsSent: vi.fn(),
};
vi.mock('../hooks/use-chat-video-links', () => ({
  useChatVideoLinks: () => videoLinksState,
}));
// The parked-sends tray subscribes to Convex on its own; inert here.
vi.mock('./deferred-send-tray', () => ({
  DeferredSendTray: () => null,
}));

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
    usePendingQuestion: vi.fn(() => ({ status: 'unavailable' as const })),
    useResolveQuestion: vi.fn(() => ({
      available: false,
      resolve: () => Promise.resolve(),
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
  usePendingQuestion,
  useResolveQuestion,
} from '../data/chat-backend';
import { useThreadView } from '../hooks/use-thread-view';
import { ChatSurface } from './chat-surface';

afterEach(() => {
  navigateMock.mockReset();
  canManageProvidersMock.value = false;
  transcriptionState.statusMap = new Map();
  transcriptionState.isTranscribing = false;
  transcriptionState.isQueryLoading = false;
  indexingState.statusMap = new Map();
  indexingState.isIndexing = false;
  indexingState.isQueryLoading = false;
  videoLinksState.isAnyProcessing = false;
  videoLinksState.hasFailedJobs = false;
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
    defer: () => Promise.reject(new Error('unavailable')),
    unbindVideoJobs: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  }));
  vi.mocked(useChatModelPreference).mockImplementation(() => ({
    preference: { status: 'unavailable' as const },
    save: vi.fn(),
  }));
  vi.mocked(usePendingQuestion).mockImplementation(() => ({
    status: 'unavailable' as const,
  }));
  vi.mocked(useResolveQuestion).mockImplementation(() => ({
    available: false,
    resolve: () => Promise.resolve(),
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
      screen.getByText('Connect an AI provider to start chatting.'),
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
      defer: () => Promise.resolve({ threadId: 't-new' }),
      unbindVideoJobs: () => Promise.resolve(),
      start: () =>
        Promise.resolve({
          threadId: 't-new',
          boundVideoJobIds: [],
          outcome: Promise.resolve({ status: 'completed' as const }),
        }),
      stop: () => Promise.resolve(),
    });
  });

  it('takes text immediately and holds only the send button', async () => {
    const { user } = render(<ChatSurface organizationId="org-1" />);

    const input = screen.getByRole('textbox', { name: 'Message input' });
    expect(input).toBeEnabled();
    expect(screen.getByText(/ask a question/i)).toBeInTheDocument();

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
      defer: vi.fn(() => Promise.resolve({ threadId: 't-new' })),
      unbindVideoJobs: vi.fn(() => Promise.resolve()),
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

  // Send-then-wait: processing media no longer blocks the button — a click
  // parks the message server-side (chatSend.defer) and the watcher fires it
  // when the media settles. The direct action must NOT start. The send mock
  // installs BEFORE render: `handleSend` closes over the render-time hook.
  async function expectSendParks() {
    const defer = vi.fn(() => Promise.resolve({ threadId: 't-new' }));
    const directStart = vi.fn();
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: directStart,
      defer,
      unbindVideoJobs: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
    });
    const { user } = render(<ChatSurface organizationId="org-1" />);
    const input = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(input, 'what did they decide?');
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(defer).toHaveBeenCalledTimes(1));
    expect(directStart).not.toHaveBeenCalled();
  }

  it('parks the send while a staged clip is still transcribing', async () => {
    transcriptionState.isTranscribing = true;
    await expectSendParks();
  });

  it('parks the send until the transcription status is actually known', async () => {
    // Pessimistic during the first read: an unknown status could be
    // `running`, and parking is always safe — blocking is not.
    transcriptionState.isQueryLoading = true;
    await expectSendParks();
  });

  it('parks the send while a staged document is still indexing', async () => {
    // The turn tells the model the document is retrievable — so the turn
    // must not start before it is.
    indexingState.isIndexing = true;
    await expectSendParks();
  });

  it('parks the send while a pasted video link still processes', async () => {
    videoLinksState.isAnyProcessing = true;
    await expectSendParks();
  });

  it('sends directly once nothing is processing', async () => {
    const directStart = vi.fn(() =>
      Promise.resolve({
        threadId: 't-new',
        boundVideoJobIds: [],
        outcome: Promise.resolve({ status: 'completed' as const }),
      }),
    );
    const defer = vi.fn(() => Promise.resolve({ threadId: 't-new' }));
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: directStart,
      defer,
      unbindVideoJobs: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
    });
    const { user } = render(<ChatSurface organizationId="org-1" />);

    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'what did they decide?',
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(directStart).toHaveBeenCalledTimes(1));
    expect(defer).not.toHaveBeenCalled();
  });

  it('blocks send only for a FAILED video chip — the user must retry or remove', async () => {
    videoLinksState.hasFailedJobs = true;
    const { user } = render(<ChatSurface organizationId="org-1" />);

    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'what did they decide?',
    );

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
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
      await screen.findByRole('menuitemradio', {
        name: (name: string) => name.startsWith('deepseek-reasoner'),
      }),
    );

    expect(save).toHaveBeenCalledWith('deepseek-reasoner');
  });

  it('defaults a fresh session to Auto when the catalog offers a choice', () => {
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL, SECOND_MODEL],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatModelPreference).mockReturnValue({
      preference: { status: 'ready', data: undefined },
      save: vi.fn(),
    });

    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toHaveTextContent('Auto');
  });

  it('seeds the single model of a one-model catalog, never Auto', () => {
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatModelPreference).mockReturnValue({
      preference: { status: 'ready', data: undefined },
      save: vi.fn(),
    });

    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toHaveTextContent(MODEL.label);
  });

  it('clears the sticky pick when the user chooses Auto', async () => {
    const save = vi.fn();
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL, SECOND_MODEL],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatModelPreference).mockReturnValue({
      preference: { status: 'ready', data: SECOND_MODEL.id },
      save,
    });

    const { user } = render(<ChatSurface organizationId="org-1" />);

    // Sticky pick seeded — nothing saved yet.
    expect(save).not.toHaveBeenCalled();

    await openSection(user, /^Model/);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Auto' }));

    expect(save).toHaveBeenCalledWith(undefined);
  });

  it('sends the Auto mode on the wire, never a model id', async () => {
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [MODEL, SECOND_MODEL],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    });
    vi.mocked(useChatModelPreference).mockReturnValue({
      preference: { status: 'ready', data: undefined },
      save: vi.fn(),
    });
    start.mockResolvedValue({
      threadId: 't-auto',
      boundVideoJobIds: [],
      outcome: Promise.resolve({ status: 'completed' as const }),
    });
    const { user } = render(<ChatSurface organizationId="org-1" />);

    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'pick for me',
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ modelSelection: 'auto' }),
      );
    });
    const request = start.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(request.modelId).toBeUndefined();
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
      defer: vi.fn(() => Promise.resolve({ threadId: 't-new' })),
      unbindVideoJobs: vi.fn(() => Promise.resolve()),
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
      defer: vi.fn(() => Promise.resolve({ threadId: 't-new' })),
      unbindVideoJobs: vi.fn(() => Promise.resolve()),
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
      defer: vi.fn(() => Promise.resolve({ threadId: 't-new' })),
      unbindVideoJobs: vi.fn(() => Promise.resolve()),
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

    // 'Archived' also names the sidebar's archived-chats section — the banner
    // is the instance sitting beside the Unarchive action.
    expect(
      screen
        .getAllByText('Archived')
        .some((el) => el.parentElement?.querySelector('button') !== null),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Unarchive' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message input' })).toBeNull();
  });
});

/**
 * A pending question must never outlive the conversation moving on.
 *
 * There used to be a "Type instead" button that superseded it, and that was
 * the ONLY path that did. `Other…` covers answering in your own words on
 * every question, so the button was removed — which makes this the only way a
 * question ever retires without being answered. Without it, collapsing the
 * panel and simply saying something else leaves the row pending and the bar
 * offering it forever.
 */
describe('ChatSurface when a question is pending', () => {
  const QUESTION = {
    requestId: 'appr_1',
    set: {
      questions: [
        {
          id: 'purpose',
          question: "What's the purpose of this email?",
          options: [
            { label: 'Request an approval' },
            { label: 'Follow up on a meeting' },
          ],
        },
      ],
    },
  };

  function armQuestion() {
    const resolve = vi.fn(() => Promise.resolve());
    // Send is gated on a resolved model and a loaded thread; without both,
    // Enter does nothing and the test would pass for the wrong reason.
    vi.mocked(useComposerModels).mockReturnValue({
      status: 'ready',
      data: {
        models: [
          {
            id: 'anthropic/claude-fable-5',
            label: 'Fable',
            providerSlug: 'anthropic',
            credential: { authMethod: 'api-key' },
          },
        ],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      },
    } as unknown as ReturnType<typeof useComposerModels>);
    vi.mocked(useChatThreads).mockReturnValue({
      status: 'ready',
      data: [],
    } as unknown as ReturnType<typeof useChatThreads>);
    vi.mocked(useThreadView).mockReturnValue({
      status: 'ready' as const,
      items: [],
      generation: null,
      streamingMessageId: undefined,
      pendingConsumed: false,
    } as unknown as ReturnType<typeof useThreadView>);
    vi.mocked(usePendingQuestion).mockReturnValue({
      status: 'ready' as const,
      data: QUESTION,
    } as ReturnType<typeof usePendingQuestion>);
    vi.mocked(useResolveQuestion).mockReturnValue({
      available: true,
      resolve,
    } as unknown as ReturnType<typeof useResolveQuestion>);
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: () =>
        Promise.resolve({
          threadId: 'thread-1',
          outcome: Promise.resolve({ status: 'completed' as const }),
        }),
      stop: () => Promise.resolve(),
    } as unknown as ReturnType<typeof useChatSend>);
    return resolve;
  }

  // Closing the row is bookkeeping; sending is the conversation. Awaiting the
  // write ahead of the send meant a Convex hiccup — a stale deployment
  // rejecting a new argument, say — silently discarded every answer the
  // person had just given, under a message telling them to try again.
  it('sends the answers even when recording them fails', async () => {
    const resolve = vi.fn(() => Promise.reject(new Error('stale validator')));
    armQuestion();
    vi.mocked(useResolveQuestion).mockReturnValue({
      available: true,
      resolve,
    } as unknown as ReturnType<typeof useResolveQuestion>);
    const sent: string[] = [];
    vi.mocked(useChatSend).mockReturnValue({
      available: true,
      start: (input: { text: string }) => {
        sent.push(input.text);
        return Promise.resolve({
          threadId: 'thread-1',
          outcome: Promise.resolve({ status: 'completed' as const }),
        });
      },
      stop: () => Promise.resolve(),
    } as unknown as ReturnType<typeof useChatSend>);

    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="thread-1" />,
    );
    await user.click(
      screen.getByRole('radio', { name: /Request an approval/ }),
    );

    expect(resolve).toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Request an approval');
    // And the person is not told to try again for something that worked.
    expect(
      screen.queryByText("Couldn't send your answers. Try again."),
    ).not.toBeInTheDocument();
  });

  // The bar above the composer offering a question that has just been
  // answered, with the reply to it streaming directly above, was the symptom.
  // The UI must not wait on the write that closes the row.
  it('takes the question off screen the moment it is answered', async () => {
    const resolve = vi.fn(() => Promise.reject(new Error('stale validator')));
    armQuestion();
    vi.mocked(useResolveQuestion).mockReturnValue({
      available: true,
      resolve,
    } as unknown as ReturnType<typeof useResolveQuestion>);

    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="thread-1" />,
    );
    await user.click(
      screen.getByRole('radio', { name: /Request an approval/ }),
    );

    // Neither the panel nor the collapsed bar it hides behind.
    expect(
      screen.queryByText("What's the purpose of this email?"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Answer the question/)).not.toBeInTheDocument();
  });

  it('retires the question outright on Skip', async () => {
    const resolve = armQuestion();
    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="thread-1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(resolve).toHaveBeenCalledWith('appr_1', 'superseded');
  });

  it('retires the question when the person says something else instead', async () => {
    const resolve = armQuestion();
    const { user } = render(
      <ChatSurface organizationId="org-1" threadId="thread-1" />,
    );

    // Esc, not Skip: Skip retires the question by itself, which would prove
    // nothing about typing. Collapsing leaves it outstanding, so the send is
    // the only thing that can retire it.
    await user.keyboard('{Escape}');
    const box = screen.getByRole('textbox');
    await user.type(
      box,
      'actually, never mind — summarise the contract{Enter}',
    );

    expect(resolve).toHaveBeenCalledWith('appr_1', 'superseded');
  });
});
