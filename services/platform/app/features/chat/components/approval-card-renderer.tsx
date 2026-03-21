'use client';

import type { ChatItem } from '../hooks/use-merged-chat-items';

import { DocumentWriteApprovalCard } from './document-write-approval-card';
import { HumanInputRequestCard } from './human-input-request-card';
import { IntegrationApprovalCard } from './integration-approval-card';
import { WorkflowCreationApprovalCard } from './workflow-creation-approval-card';
import { WorkflowRunApprovalCard } from './workflow-run-approval-card';
import { WorkflowUpdateApprovalCard } from './workflow-update-approval-card';

interface ApprovalCardRendererProps {
  item: ChatItem;
  organizationId: string;
  onHumanInputResponseSubmitted?: () => void;
}

export function ApprovalCardRenderer({
  item,
  organizationId,
  onHumanInputResponseSubmitted,
}: ApprovalCardRendererProps) {
  if (item.type === 'message') return null;

  return (
    <div className="flex justify-start">
      {item.type === 'approval' && (
        <IntegrationApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      )}
      {item.type === 'workflow_approval' && (
        <WorkflowCreationApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      )}
      {item.type === 'workflow_update_approval' && (
        <WorkflowUpdateApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      )}
      {item.type === 'workflow_run_approval' && (
        <WorkflowRunApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      )}
      {item.type === 'human_input_request' && (
        <HumanInputRequestCard
          approvalId={item.data._id}
          status={item.data.status}
          metadata={item.data.metadata}
          isWorkflowContext={!!item.data.wfExecutionId}
          wfExecutionId={item.data.wfExecutionId}
          onResponseSubmitted={onHumanInputResponseSubmitted}
        />
      )}
      {item.type === 'document_write_approval' && (
        <DocumentWriteApprovalCard
          approvalId={item.data._id}
          organizationId={organizationId}
          status={item.data.status}
          metadata={item.data.metadata}
          executedAt={item.data.executedAt}
          executionError={item.data.executionError}
        />
      )}
    </div>
  );
}
