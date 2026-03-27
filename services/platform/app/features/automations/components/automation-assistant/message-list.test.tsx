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

vi.mock('@/app/features/chat/components/approval-card-renderer', () => ({
  ApprovalCardRenderer: ({
    item,
  }: {
    item: { type: string; data: { _id: string } };
  }) => (
    <div data-testid={`${item.type}-approval-${item.data._id}`}>
      {item.type} Approval
    </div>
  ),
}));

vi.mock('@/app/features/chat/components/collapsible-system-message', () => ({
  CollapsibleSystemMessage: ({ content }: { content: string }) => (
    <div data-testid="system-message">{content}</div>
  ),
}));

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
  workflowRunApprovals: [],
  humanInputRequests: [],
  documentWriteApprovals: [],
  integrationApprovals: [],
};

describe('MessageList', () => {
  afterEach(cleanup);

  describe('approval rendering', () => {
    it('renders a pending approval at the bottom', () => {
      const message = createMessage({ id: 'msg-1', content: 'AI response' });
      const approval = createUpdateApproval({
        _id: 'approval-1' as Id<'approvals'>,
        messageId: 'msg-1',
        status: 'pending',
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
        screen.getByTestId('workflow_update_approval-approval-approval-1'),
      ).toBeInTheDocument();
    });

    it('does not render completed approvals', () => {
      const message = createMessage({ id: 'msg-2', content: 'Recent message' });
      const completedApproval = createUpdateApproval({
        _id: 'completed-ap' as Id<'approvals'>,
        messageId: 'msg-2',
        status: 'completed',
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[message]}
          workflowUpdateApprovals={[completedApproval]}
          workflowCreationApprovals={[]}
        />,
      );

      expect(
        screen.queryByTestId('workflow_update_approval-approval-completed-ap'),
      ).not.toBeInTheDocument();
    });

    it('does not render rejected approvals', () => {
      const message = createMessage({ id: 'msg-3' });
      const rejectedApproval = createUpdateApproval({
        _id: 'rejected-ap' as Id<'approvals'>,
        messageId: 'msg-3',
        status: 'rejected',
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[message]}
          workflowUpdateApprovals={[rejectedApproval]}
          workflowCreationApprovals={[]}
        />,
      );

      expect(
        screen.queryByTestId('workflow_update_approval-approval-rejected-ap'),
      ).not.toBeInTheDocument();
    });

    it('shows only the latest pending approval when multiple exist', () => {
      const message = createMessage({ id: 'msg-4' });
      const olderApproval = createUpdateApproval({
        _id: 'ap-1' as Id<'approvals'>,
        messageId: 'msg-4',
        status: 'pending',
        _creationTime: 1000,
      });
      const newerApproval = createCreationApproval({
        _id: 'ap-2' as Id<'approvals'>,
        messageId: 'msg-4',
        status: 'pending',
        _creationTime: 2000,
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[message]}
          workflowUpdateApprovals={[olderApproval]}
          workflowCreationApprovals={[newerApproval]}
        />,
      );

      // Only the latest (ap-2) should be shown
      expect(
        screen.getByTestId('workflow_approval-approval-ap-2'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('workflow_update_approval-approval-ap-1'),
      ).not.toBeInTheDocument();
    });

    it('shows only the latest active approval when multiple pending exist across types', () => {
      const message = createMessage({ id: 'msg-5' });
      const olderPending = createUpdateApproval({
        _id: 'older-ap' as Id<'approvals'>,
        status: 'pending',
        _creationTime: 1000,
      });
      const newerPending = createUpdateApproval({
        _id: 'newer-ap' as Id<'approvals'>,
        status: 'pending',
        _creationTime: 2000,
      });

      render(
        <MessageList
          {...defaultProps}
          displayMessages={[message]}
          workflowUpdateApprovals={[olderPending, newerPending]}
          workflowCreationApprovals={[]}
        />,
      );

      // Only the latest (newer-ap) should render
      expect(
        screen.getByTestId('workflow_update_approval-approval-newer-ap'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('workflow_update_approval-approval-older-ap'),
      ).not.toBeInTheDocument();
    });
  });
});
