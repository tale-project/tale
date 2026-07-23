// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

// Per-test discussion payload (status drives the header badge + composer gate).
let discussionData:
  | {
      title: string;
      discussionStatus: string;
      discussionCategory?: string;
      linkedTaskId?: string | null;
    }
  | undefined;
// Per-test transcript payload.
let messagesData: Array<{
  messageId: string;
  role: 'user' | 'assistant';
  authorId?: string;
  body: string;
  createdAt: number;
}> = [];
vi.mock('../hooks/queries', () => ({
  useDiscussion: () => ({ data: discussionData }),
  useDiscussionMessages: () => ({ data: messagesData }),
}));

const postReply = vi.fn().mockResolvedValue({
  mentionCount: 0,
  unresolvedMentionTokens: [],
});
vi.mock('../hooks/mutations', () => ({
  usePostReply: () => ({ mutateAsync: postReply }),
  useSetDiscussionStatus: () => ({ mutateAsync: vi.fn() }),
  useCreateTaskFromDiscussion: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../tasks/hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    // Resolves the seeded ids; anything else echoes the id back (a miss).
    resolveActor: (type: string, id: string) => ({
      name:
        type === 'user' && id === 'user_1'
          ? 'Israel'
          : type === 'agent' && id === 'support-agent'
            ? 'Support Agent'
            : id,
    }),
    currentUserId: 'user_1',
  }),
}));

vi.mock('../../tasks/components/mention-text', () => ({
  MentionText: ({ body }: { body: string }) => <p>{body}</p>,
}));

vi.mock('../../tasks/components/mention-textarea', () => ({
  MentionTextarea: (props: {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    onValueChange?: (next: string) => void;
  }) => (
    <textarea
      placeholder={props.placeholder}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onValueChange?.(e.target.value)}
    />
  ),
}));

vi.mock('../../tasks/components/mention-trigger-chips', () => ({
  MentionTriggerChips: () => null,
}));

import { DiscussionThreadView } from './discussion-thread-view';

function renderThreadView(onBack = vi.fn()) {
  return render(
    <DiscussionThreadView
      organizationId="org-1"
      projectId={'project-1' as never}
      threadId="thread-1"
      onBack={onBack}
    />,
  );
}

describe('DiscussionThreadView', () => {
  it('shows the header metadata and renders the transcript with resolved authors', () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'open' };
    messagesData = [
      {
        messageId: 'msg_1',
        // The opening post is stored role:'assistant' yet human-authored —
        // attribution must come from authorId, never the role.
        role: 'assistant',
        authorId: 'user_1',
        body: 'Shall we roll out on Friday?',
        createdAt: Date.now(),
      },
      {
        messageId: 'msg_2',
        role: 'assistant',
        authorId: 'support-agent',
        body: 'Friday works — the error budget is green.',
        createdAt: Date.now(),
      },
    ];
    renderThreadView();

    expect(screen.getByText('Rollout plan')).toBeInTheDocument();
    expect(screen.getByText('discussions.status.open')).toBeInTheDocument();
    expect(
      screen.getByText('Shall we roll out on Friday?'),
    ).toBeInTheDocument();
    // The human opener is attributed to the member, not to an agent.
    expect(screen.getByText('Israel')).toBeInTheDocument();
    expect(screen.getByText('Support Agent')).toBeInTheDocument();
  });

  it('renders a system notice as a plain transcript line without an author row', () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'open' };
    messagesData = [
      {
        messageId: 'msg_sys',
        role: 'assistant',
        authorId: 'system',
        body: 'This discussion was converted to a task.',
        createdAt: Date.now(),
      },
    ];
    renderThreadView();

    expect(
      screen.getByText('This discussion was converted to a task.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('system')).not.toBeInTheDocument();
  });

  it('keeps the way back to the list reachable', async () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'open' };
    messagesData = [];
    const onBack = vi.fn();
    const { user } = renderThreadView(onBack);

    await user.click(
      screen.getByRole('button', { name: 'discussions.backToList' }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('posts a reply through the composer', async () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'open' };
    messagesData = [];
    const { user } = renderThreadView();

    await user.type(screen.getByRole('textbox'), 'On it.');
    await user.click(
      screen.getByRole('button', { name: 'discussions.reply.send' }),
    );
    expect(postReply).toHaveBeenCalledWith({
      organizationId: 'org-1',
      threadId: 'thread-1',
      message: 'On it.',
    });
  });

  it('disables the composer when the discussion is locked', () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'locked' };
    messagesData = [];
    renderThreadView();

    const textarea = screen.getByPlaceholderText(
      'discussions.reply.lockedPlaceholder',
    );
    expect(textarea).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'discussions.reply.send' }),
    ).toBeDisabled();
  });
});
