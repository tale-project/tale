// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { TaskReviewCard } from './task-review-card';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

const mutateAsync = vi.fn(async () => ({
  taskCompleted: true,
  agentKicked: false,
}));
let mockReview: {
  approvalId: string;
  question?: string;
  agentSlug?: string;
  requestedFor?: string;
  requestedAt: number;
} | null = null;

vi.mock('../hooks/queries', () => ({
  usePendingTaskReview: () => ({ review: mockReview, isLoading: false }),
}));
vi.mock('../hooks/mutations', () => ({
  useRespondToTaskReview: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: (_type: string, id: string) => ({
      type: 'user',
      id,
      name: id === 'user-2' ? 'Bea' : id,
      isAgent: false,
    }),
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-1' } }),
}));
vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

const TASK_ID = 'task-1' as Id<'tasks'>;

describe('TaskReviewCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReview = {
      approvalId: 'appr-1',
      agentSlug: 'Helper',
      requestedAt: 0,
    };
  });

  it('renders nothing without a pending review', () => {
    mockReview = null;
    render(<TaskReviewCard taskId={TASK_ID} organizationId="org-1" canEdit />);
    expect(
      screen.queryByText('tasks.review.needsReview'),
    ).not.toBeInTheDocument();
  });

  it('shows the actions to an editor', () => {
    render(<TaskReviewCard taskId={TASK_ID} organizationId="org-1" canEdit />);
    expect(screen.getByText('tasks.review.approve')).toBeInTheDocument();
    expect(screen.getByText('tasks.review.requestChanges')).toBeInTheDocument();
  });

  it('hides the actions from a read-only viewer — the card itself stays', () => {
    render(<TaskReviewCard taskId={TASK_ID} organizationId="org-1" />);
    expect(screen.getByText('tasks.review.needsReview')).toBeInTheDocument();
    expect(screen.queryByText('tasks.review.approve')).not.toBeInTheDocument();
    expect(
      screen.queryByText('tasks.review.requestChanges'),
    ).not.toBeInTheDocument();
  });

  it('names the reviewer it waits on — You for the viewer, the name otherwise', () => {
    mockReview = {
      approvalId: 'appr-1',
      agentSlug: 'Helper',
      requestedAt: 0,
      requestedFor: 'user-1',
    };
    const first = render(
      <TaskReviewCard taskId={TASK_ID} organizationId="org-1" canEdit />,
    );
    expect(screen.getByText('tasks.review.waitingOnYou')).toBeInTheDocument();
    first.unmount();

    mockReview = {
      approvalId: 'appr-1',
      agentSlug: 'Helper',
      requestedAt: 0,
      requestedFor: 'user-2',
    };
    render(<TaskReviewCard taskId={TASK_ID} organizationId="org-1" canEdit />);
    expect(screen.getByText('tasks.review.waitingOn')).toBeInTheDocument();
  });

  it('requires feedback before Send feedback submits', async () => {
    const { user } = render(
      <TaskReviewCard taskId={TASK_ID} organizationId="org-1" canEdit />,
    );

    await user.click(screen.getByText('tasks.review.requestChanges'));
    const send = screen.getByRole('button', {
      name: 'tasks.review.sendFeedback',
    });
    expect(send).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText('tasks.review.feedbackPlaceholder'),
      'Fix the totals',
    );
    expect(send).toBeEnabled();
    await user.click(send);
    expect(mutateAsync).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      decision: 'request_changes',
      feedback: 'Fix the totals',
    });
  });

  it('approve submits the decision', async () => {
    const { user } = render(
      <TaskReviewCard taskId={TASK_ID} organizationId="org-1" canEdit />,
    );
    await user.click(screen.getByText('tasks.review.approve'));
    expect(mutateAsync).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      decision: 'approve',
      feedback: undefined,
    });
  });
});
