// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

// The thread view navigates (back-to-board, view-task) and renders a Link;
// there is no RouterProvider here — same no-op stubs as the other route-less
// component tests.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: React.ReactNode }) => (
    // Router-Link test double, not real navigation.
    // oxlint-disable-next-line jsx-a11y/anchor-is-valid
    <a href="#">{children}</a>
  ),
}));

vi.mock('../../chat/hooks/use-convex-file-upload', () => ({
  useConvexFileUpload: () => ({
    attachments: [],
    uploadingFiles: [],
    uploadFiles: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
  }),
}));

// Convex-backed streaming pipeline — the composer contract under test doesn't
// need messages.
vi.mock('../../chat/hooks/use-message-processing', () => ({
  useMessageProcessing: () => ({ messages: [] }),
}));

// MessageBubble pulls the whole markdown/chat rendering stack; no entries
// render here anyway.
vi.mock('../../chat/components/message-bubble', () => ({
  MessageBubble: () => null,
}));

vi.mock('../../tasks/hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: (_type: 'user' | 'agent', id: string) => ({ name: id }),
    currentUserId: 'user-1',
  }),
}));

vi.mock('../../tasks/lib/mention-actor-options', () => ({
  useMentionActorOptions: () => [],
}));

vi.mock('../hooks/mutations', () => ({
  usePostReply: () => ({ mutateAsync: vi.fn() }),
  useSetDiscussionStatus: () => ({ mutateAsync: vi.fn() }),
  useCreateTaskFromDiscussion: () => ({ mutateAsync: vi.fn() }),
}));

// Per-test discussion payload (status drives the locked composer state).
let discussionData:
  | {
      title: string;
      discussionStatus: string;
      discussionCategory?: string;
      linkedTaskId?: string | null;
    }
  | undefined;
vi.mock('../hooks/queries', () => ({
  useDiscussion: () => ({ data: discussionData }),
}));

// The composer contract is the unit under test: spy on the props the view
// hands to the shared ChatInput (same tier-down as the sibling
// discussion-create-dialog test).
const chatInputSpy = vi.fn();
vi.mock('../../chat/components/chat-input', () => ({
  ChatInput: (props: Record<string, unknown>) => {
    chatInputSpy(props);
    return <div data-testid="chat-input" />;
  },
}));

import { DiscussionThreadView } from './discussion-thread-view';

function renderThreadView() {
  chatInputSpy.mockClear();
  return render(
    <DiscussionThreadView
      organizationId="org-1"
      projectId={'project-1' as never}
      threadId="thread-1"
      onBack={vi.fn()}
    />,
  );
}

function lastChatInputProps(): Record<string, unknown> {
  const props = chatInputSpy.mock.calls.at(-1)?.[0] as
    | Record<string, unknown>
    | undefined;
  expect(props).toBeDefined();
  return props as Record<string, unknown>;
}

describe('DiscussionThreadView locked composer', () => {
  // #2680 regression: the locked composer used to borrow chat's `'archived'`
  // disabled reason, so it read "This chat is archived…" instead of the
  // discussions locked notice right under the "Locked" pill.
  it('hands ChatInput the discussions locked notice when locked', () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'locked' };
    renderThreadView();

    // The header confirms the locked scenario (Unlock affordance visible)…
    expect(
      screen.getByRole('button', { name: 'discussions.unlock' }),
    ).toBeInTheDocument();

    // …and the composer is disabled with the discussions-owned copy, never
    // chat's archived reason.
    expect(lastChatInputProps()).toMatchObject({
      disabled: true,
      disabledReason: 'locked',
      disabledMessage: 'discussions.reply.lockedPlaceholder',
      placeholder: 'discussions.reply.lockedPlaceholder',
    });
  });

  it('leaves the composer enabled with no disabled reason when open', () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'open' };
    renderThreadView();

    const props = lastChatInputProps();
    expect(props).toMatchObject({
      disabled: false,
      placeholder: 'discussions.reply.placeholder',
    });
    expect(props.disabledReason).toBeUndefined();
    expect(props.disabledMessage).toBeUndefined();
  });
});
