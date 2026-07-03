'use client';

import { Row } from '@tale/ui/layout';
import type { ReactNode } from 'react';

import type { ChatItem } from '../hooks/use-merged-chat-items';
import { DocumentWriteApprovalCard } from './document-write-approval-card';
import { HumanInputRequestCard } from './human-input-request-card';
import { IntegrationApprovalCard } from './integration-approval-card';
import { JobCard } from './job-card';
import { KnowledgeWriteApprovalCard } from './knowledge-write-approval-card';
import { LocationRequestCard } from './location-request-card';
import { PlanApprovalCard } from './plan-approval-card';
import { WorkflowCreationApprovalCard } from './workflow-creation-approval-card';
import { WorkflowRunApprovalCard } from './workflow-run-approval-card';
import { WorkflowUpdateApprovalCard } from './workflow-update-approval-card';

interface ApprovalCardRendererProps {
  item: ChatItem;
  organizationId: string;
  /** Owning thread — required by cards that act on the thread (plan card). */
  threadId?: string;
  onHumanInputResponseSubmitted?: () => void;
  onSendMessage?: (message: string) => void;
}

/**
 * Maps a non-message `ChatItem` (an approval, a human-input request, a location
 * request, …) to its card. One labeled `case` per kind — clearer than the old
 * `{item.type === 'x' && <Card/>}` chain and exhaustive over the union — wrapped
 * once in the shared left-aligned row. Message items render no card.
 */
export function ApprovalCardRenderer({
  item,
  organizationId,
  threadId,
  onHumanInputResponseSubmitted,
  onSendMessage,
}: ApprovalCardRendererProps) {
  if (item.type === 'message') return null;

  let card: ReactNode = null;
  switch (item.type) {
    case 'approval':
      card = (
        <IntegrationApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
          onSendMessage={onSendMessage}
        />
      );
      break;
    case 'workflow_approval':
      card = (
        <WorkflowCreationApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      );
      break;
    case 'workflow_update_approval':
      card = (
        <WorkflowUpdateApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      );
      break;
    case 'workflow_run_approval':
      card = (
        <WorkflowRunApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      );
      break;
    case 'human_input_request':
      card = (
        <HumanInputRequestCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          isWorkflowContext={!!item.data.wfExecutionId}
          wfExecutionId={item.data.wfExecutionId}
          onResponseSubmitted={onHumanInputResponseSubmitted}
        />
      );
      break;
    case 'location_request':
      card = (
        <LocationRequestCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          isWorkflowContext={!!item.data.wfExecutionId}
          onResponseSubmitted={onHumanInputResponseSubmitted}
        />
      );
      break;
    case 'document_write_approval':
      card = (
        <DocumentWriteApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      );
      break;
    case 'knowledge_write_approval':
      card = (
        <KnowledgeWriteApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      );
      break;
    case 'plan_approval':
      card =
        threadId !== undefined ? (
          <PlanApprovalCard
            approvalId={item.data._id}
            organizationId={organizationId}
            threadId={threadId}
            status={item.data.status}
            metadata={item.data.metadata}
          />
        ) : null;
      break;
    case 'job':
      card = <JobCard job={item.data} />;
      break;
    default:
      // Any other non-message ChatItem kind renders no card.
      card = null;
  }

  if (!card) return null;
  return (
    <Row gap={0} align="stretch">
      {card}
    </Row>
  );
}
