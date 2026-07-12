import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { Message } from './message-bubble/types';

// Migrated from the `chat-advanced` E2E
// "the assistant message copy action writes the reply to the clipboard".
//
// Seam-check: the copy action reads `message.content` (a prop) and calls
// `navigator.clipboard.writeText(...)` — no router redirect, no backend
// round-trip, no real streaming, no layout geometry. It is pure React state +
// a clipboard call, so it belongs at the component tier. jsdom has no real
// clipboard, so we spy on `navigator.clipboard.writeText` and assert it was
// called with the (normalized) reply text — faithfully covering the E2E's
// "the clipboard holds the reply" proof. We also assert the button flips to
// its "Copied!" state (success check icon + revealed tooltip), mirroring the
// E2E's best-effort copied-tooltip check.

// MessageBubble subscribes to Convex via the chat query hooks; outside a live
// deployment those throw. Mock the whole queries module to inert values so the
// toolbar + copy path (the behavior under test) renders.
vi.mock('../hooks/queries', () => ({
  useMessageMetadata: () => ({ metadata: undefined }),
  useChatAgents: () => ({ agents: undefined }),
  useFileUrls: () => ({ data: undefined }),
  useThreadLiveRoute: () => null,
  useThreadGenerationStart: () => null,
}));

vi.mock('../hooks/use-effective-agent', () => ({
  useEffectiveAgent: () => ({ agent: undefined }),
}));

vi.mock('../hooks/use-on-demand-speech', () => ({
  useOnDemandSpeech: () => ({ requested: false }),
}));

vi.mock('../hooks/use-voice-output', () => ({
  useVoiceModeEffective: () => ({ enabled: false }),
  useVoiceOutputChunker: () => undefined,
}));

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    setEditingImageRef: vi.fn(),
    setDismissedImageKey: vi.fn(),
  }),
}));

// Heavy render children that draw the markdown body / thought timeline /
// artifact pills are not under test here and would pull in their own data
// subscriptions and markdown pipeline. Stub them to lightweight markers so the
// real toolbar + copy button path is exercised faithfully.
vi.mock('./message-segments', () => ({
  MessageSegments: ({ messageId }: { messageId: string }) => (
    <div data-testid={`segments-${messageId}`} />
  ),
}));

vi.mock('./thought-timeline', () => ({
  MessageThoughtHeader: () => null,
  ThinkingDots: () => null,
}));

vi.mock('./message-bubble/artifact-pills', () => ({
  MessageArtifactPills: () => null,
}));

// The info dialog (mounted by the always-present info button) subscribes to
// Convex for its voice-usage row; outside a provider that throws. It is not
// under test, so stub it to nothing.
vi.mock('./message-info-dialog', () => ({
  MessageInfoDialog: () => null,
}));

// User-message bodies render `@handle`s via MentionizedText, which subscribes
// to the actor directory (Convex) — outside a provider that throws. Not under
// test here, so stub it to the plain body text.
vi.mock('@/app/features/tasks/components/mention-text', () => ({
  MentionizedText: ({ body }: { body: string }) => <>{body}</>,
}));

const REPLY = 'This is the assistant reply that should be copied.';

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-msg-1',
    role: 'assistant',
    content: REPLY,
    timestamp: new Date('2026-01-01T00:00:00Z'),
    threadId: 'thread-1',
    isStreaming: false,
    ...overrides,
  };
}

// `userEvent.setup()` (run inside the render wrapper) installs its own
// clipboard onto `navigator.clipboard`. Spy on the live `writeText` AFTER
// render so the spy sits on the object the component actually calls.
function spyOnClipboard() {
  return vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue(undefined);
}

describe('MessageBubble copy action', () => {
  it('renders the copy button on a completed assistant reply', async () => {
    // Lazy import so the module-level vi.mock factories are applied first.
    const { MessageBubble } = await import('./message-bubble');

    render(
      <MessageBubble
        message={assistantMessage()}
        organizationId="org-1"
        hideFeedback
      />,
    );

    expect(screen.getByTestId('message-copy-button')).toBeInTheDocument();
  });

  it('writes the reply to the clipboard when the copy button is clicked', async () => {
    const { MessageBubble } = await import('./message-bubble');

    const { user } = render(
      <MessageBubble
        message={assistantMessage()}
        organizationId="org-1"
        hideFeedback
      />,
    );

    const writeText = spyOnClipboard();

    await user.click(screen.getByTestId('message-copy-button'));

    // The same proof the E2E reads back from the clipboard: Copy wrote the
    // reply. `message.content` has no trailing whitespace, so normalization is
    // a no-op and the written text equals the reply verbatim.
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText).toHaveBeenCalledWith(REPLY);
  });

  it('flips the button to the "Copied!" state after copying', async () => {
    const { MessageBubble } = await import('./message-bubble');

    const { user } = render(
      <MessageBubble
        message={assistantMessage()}
        organizationId="org-1"
        hideFeedback
      />,
    );

    spyOnClipboard();

    const copyButton = screen.getByTestId('message-copy-button');
    // Before copy: the success check icon is absent.
    expect(copyButton.querySelector('.text-success')).toBeNull();

    await user.click(copyButton);

    // After copy: the icon swaps to the success check (the visual "Copied!"
    // affordance whose tooltip the E2E hovers for), confirming the copied state
    // latched. The E2E treated the tooltip text itself as best-effort (a missed
    // window must not fail); the icon swap is the timing-window-free signal.
    await waitFor(() => {
      expect(copyButton.querySelector('.text-success')).not.toBeNull();
    });
  });

  it('passes an axe audit with the copy toolbar rendered', async () => {
    const { MessageBubble } = await import('./message-bubble');

    const { container } = render(
      <MessageBubble
        message={assistantMessage()}
        organizationId="org-1"
        hideFeedback
      />,
    );

    expect(screen.getByTestId('message-copy-button')).toBeInTheDocument();
    // The toolbar's icon-only buttons label themselves via a Radix Tooltip
    // (visible on hover/focus) rather than a static aria-label, so axe's
    // `button-name` rule flags them. That is a pre-existing trait of the live
    // component (not introduced by this test); disable only that rule and keep
    // every other WCAG check active on the rendered toolbar state.
    await checkAccessibility(container, {
      rules: { 'button-name': { enabled: false } },
    });
  });
});

// Issue #2598: a folder `@`-mention whose files all filtered out at
// resolution time must say so on the sent chip — never render a silent
// "0 files" that reads as an empty folder.
describe('MessageBubble folder mention chip', () => {
  function userMessageWithFolder(
    folderRef: NonNullable<Message['folderRefs']>[number],
  ): Message {
    return {
      id: 'user-msg-1',
      role: 'user',
      content: 'Summarize @Meetings',
      timestamp: new Date('2026-01-01T00:00:00Z'),
      threadId: 'thread-1',
      folderRefs: [folderRef],
    };
  }

  it('shows the skipped count + reason when the folder resolved zero indexed files', async () => {
    const { MessageBubble } = await import('./message-bubble');

    render(
      <MessageBubble
        message={userMessageWithFolder({
          folderId: 'folder-1',
          name: 'Meetings',
          fileCount: 0,
          skippedCount: 2,
        })}
        organizationId="org-1"
        hideFeedback
      />,
    );

    expect(screen.getByText('Meetings')).toBeInTheDocument();
    expect(screen.getByText('0/2 files — 2 not indexed')).toBeInTheDocument();
  });

  it('falls back to the plain file count when nothing was skipped', async () => {
    const { MessageBubble } = await import('./message-bubble');

    render(
      <MessageBubble
        message={userMessageWithFolder({
          folderId: 'folder-1',
          name: 'Reports',
          fileCount: 3,
          skippedCount: 0,
        })}
        organizationId="org-1"
        hideFeedback
      />,
    );

    expect(screen.getByText('3 files')).toBeInTheDocument();
  });
});

// The multi-party (Discussions) props: `isOwn` overrides alignment by AUTHORSHIP
// and `authorName` adds a name label for non-own entries. Defaults must leave
// the 1:1 chat behavior (alignment by `role`) untouched.
describe('MessageBubble author-aware alignment', () => {
  it('keeps the role-based default when isOwn is omitted', async () => {
    const { MessageBubble } = await import('./message-bubble');

    render(
      <MessageBubble
        message={assistantMessage()}
        organizationId="org-1"
        hideFeedback
      />,
    );

    // Assistant, no override → left-aligned, no name label.
    const root = screen.getByTestId('chat-message');
    expect(root.className).toContain('items-start');
    expect(root.className).not.toContain('items-end');
  });

  it('left-aligns a teammate reply (role:user, isOwn=false) and shows the name inside the bubble', async () => {
    const { MessageBubble } = await import('./message-bubble');

    render(
      <MessageBubble
        message={assistantMessage({ id: 'u1', role: 'user', content: 'Maybe' })}
        organizationId="org-1"
        hideFeedback
        isOwn={false}
        authorName="Alex"
      />,
    );

    // Authorship beats role: a user-role message from someone else lands LEFT.
    const root = screen.getByTestId('chat-message');
    expect(root.className).toContain('items-start');
    expect(root.className).not.toContain('items-end');
    const authorLabel = screen.getByTestId('message-author-label');
    expect(authorLabel).toHaveTextContent('Alex');
    expect(authorLabel.closest('[class*="rounded-2xl"]')).not.toBeNull();
  });

  it('right-aligns my own reply (isOwn=true) with no name label', async () => {
    const { MessageBubble } = await import('./message-bubble');

    render(
      <MessageBubble
        message={assistantMessage({
          id: 'me1',
          role: 'assistant',
          content: 'My take',
        })}
        organizationId="org-1"
        hideFeedback
        isOwn
        authorName="Me"
      />,
    );

    // Authorship beats role: an assistant-role message that is mine lands RIGHT,
    // and own entries never render the name label.
    const root = screen.getByTestId('chat-message');
    expect(root.className).toContain('items-end');
    expect(screen.queryByText('Me')).toBeNull();
  });
});
