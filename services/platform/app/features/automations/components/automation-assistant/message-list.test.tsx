// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import type {
  WorkflowCreationApproval,
  WorkflowUpdateApproval,
} from '@/app/features/chat/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';

import { render, screen } from '@/test/utils/render';

import type { Message } from './types';

import { MessageList } from './message-list';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@/app/features/chat/components/workflow-update-approval-card', () => ({
  WorkflowUpdateApprovalCard: ({ approvalId }: { approvalId: string }) => (
    <div data-testid={`update-approval-${approvalId}`}>Update Approval</div>
  ),
}));

vi.mock(
  '@/app/features/chat/components/workflow-creation-approval-card',
  () => ({
    WorkflowCreationApprovalCard: ({ approvalId }: { approvalId: string }) => (
      <div data-testid={`creation-approval-${approvalId}`}>
        Creation Approval
      </div>
    ),
  }),
);

vi.mock('./thinking-animation', () => ({
  ThinkingAnimation: () => <div data-testid="thinking" />,
}));

vi.mock('./automation-details-collapse', () => ({
  AutomationDetailsCollapse: () => <div data-testid="details-collapse" />,
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock('remark-gfm', () => ({
  default: () => null,
}));

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}`,
    role: 'assistant',
    content: 'Hello',
    timestamp: new Date(),
    ...overrides,
  };
}

function createUpdateApproval(
  overrides: Partial<WorkflowUpdateApproval> = {},
): WorkflowUpdateApproval {
  return {
    _id: `approval-${Date.now()}` as Id<'approvals'>,
    status: 'pending',
    metadata: {} as WorkflowUpdateApproval['metadata'],
    _creationTime: Date.now(),
    ...overrides,
  };
}

function createCreationApproval(
  overrides: Partial<WorkflowCreationApproval> = {},
): WorkflowCreationApproval {
  return {
    _id: `approval-${Date.now()}` as Id<'approvals'>,
    status: 'pending',
    metadata: {} as WorkflowCreationApproval['metadata'],
    _creationTime: Date.now(),
    ...overrides,
  };
}

const defaultProps = {
  isLoading: false,
  isWaitingForResponse: false,
  workflow: { status: 'active' },
  organizationId: 'org-1',
  onImagePreview: vi.fn(),
};

describe('MessageList', () => {
  afterEach(cleanup);

  describe('approval rendering', () => {
    it('renders approval inline after its linked message', () => {
      const message = createMessage({ id: 'msg-1', content: 'AI response' });
      const approval = createUpdateApproval({
        _id: 'approval-1' as Id<'approvals'>,
        messageId: 'msg-1',
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[message]}
          workflowUpdateApprovals={[approval]}
          workflowCreationApprovals={[]}
        />,
      );

      expect(
        screen.getByTestId('update-approval-approval-1'),
      ).toBeInTheDocument();
    });

    it('does not render approval whose messageId does not match any loaded message', () => {
      const message = createMessage({ id: 'msg-2', content: 'Recent message' });
      const orphanedApproval = createUpdateApproval({
        _id: 'orphaned-approval' as Id<'approvals'>,
        messageId: 'msg-evicted',
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[message]}
          workflowUpdateApprovals={[orphanedApproval]}
          workflowCreationApprovals={[]}
        />,
      );

      expect(
        screen.queryByTestId('update-approval-orphaned-approval'),
      ).not.toBeInTheDocument();
    });

    it('does not render approval without a messageId', () => {
      const message = createMessage({ id: 'msg-3' });
      const noMessageIdApproval = createUpdateApproval({
        _id: 'no-mid-approval' as Id<'approvals'>,
        messageId: undefined,
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[message]}
          workflowUpdateApprovals={[noMessageIdApproval]}
          workflowCreationApprovals={[]}
        />,
      );

      expect(
        screen.queryByTestId('update-approval-no-mid-approval'),
      ).not.toBeInTheDocument();
    });

    it('renders multiple approvals on the same message', () => {
      const message = createMessage({ id: 'msg-4' });
      const approval1 = createUpdateApproval({
        _id: 'ap-1' as Id<'approvals'>,
        messageId: 'msg-4',
      });
      const approval2 = createCreationApproval({
        _id: 'ap-2' as Id<'approvals'>,
        messageId: 'msg-4',
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[message]}
          workflowUpdateApprovals={[approval1]}
          workflowCreationApprovals={[approval2]}
        />,
      );

      expect(screen.getByTestId('update-approval-ap-1')).toBeInTheDocument();
      expect(screen.getByTestId('creation-approval-ap-2')).toBeInTheDocument();
    });

    it('does not render orphaned approvals at the bottom when messages are evicted from pagination', () => {
      const loadedMessage = createMessage({
        id: 'msg-recent',
        content: 'Recent',
      });
      const evictedApproval = createUpdateApproval({
        _id: 'evicted-ap' as Id<'approvals'>,
        messageId: 'msg-old-evicted',
        status: 'rejected',
      });
      const linkedApproval = createUpdateApproval({
        _id: 'linked-ap' as Id<'approvals'>,
        messageId: 'msg-recent',
        status: 'pending',
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[loadedMessage]}
          workflowUpdateApprovals={[evictedApproval, linkedApproval]}
          workflowCreationApprovals={[]}
        />,
      );

      expect(
        screen.getByTestId('update-approval-linked-ap'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('update-approval-evicted-ap'),
      ).not.toBeInTheDocument();
    });
  });
});
