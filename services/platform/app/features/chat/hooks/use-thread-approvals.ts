import { useMemo } from 'react';

import type {
  HumanControlMetadata,
  KnowledgeWriteMetadata,
  PlanApprovalMetadata,
  WorkflowCreationMetadata,
  WorkflowRunMetadata,
  WorkflowUpdateMetadata,
} from '@/convex/approvals/types';
import {
  normalizeDocumentWriteMetadata,
  type DocumentWriteMetadata,
} from '@/convex/approvals/types';
import { toId } from '@/convex/lib/type_cast_helpers';
import type {
  HumanInputRequestMetadata,
  LocationRequestMetadata,
} from '@/lib/shared/schemas/approvals';

import {
  useActiveApprovals,
  type DocumentWriteApproval,
  type HumanControlRequest,
  type HumanInputRequest,
  type IntegrationApproval,
  type IntegrationOperationMetadata,
  type KnowledgeWriteApproval,
  type LocationRequest,
  type PlanApproval,
  type WorkflowCreationApproval,
  type WorkflowRunApproval,
  type WorkflowUpdateApproval,
} from './queries';

export interface ThreadApprovals {
  integrationApprovals: IntegrationApproval[];
  workflowCreationApprovals: WorkflowCreationApproval[];
  workflowUpdateApprovals: WorkflowUpdateApproval[];
  workflowRunApprovals: WorkflowRunApproval[];
  humanInputRequests: HumanInputRequest[];
  locationRequests: LocationRequest[];
  documentWriteApprovals: DocumentWriteApproval[];
  knowledgeWriteApprovals: KnowledgeWriteApproval[];
  planApprovals: PlanApproval[];
  humanControlRequests: HumanControlRequest[];
  isLoading: boolean;
}

/**
 * Thread-scoped view over the org-wide active-approvals subscription.
 *
 * Replaces the seven independent `useIntegrationApprovals` /
 * `useWorkflow*Approvals` / `useHumanInputRequests` / `useLocationRequests` /
 * `useDocumentWriteApprovals` hooks for the chat surface: each of those
 * subscribed to the SAME `useActiveApprovals(organizationId)` query and then
 * re-filtered the full org list in its OWN `useMemo` (seven O(n) passes per
 * change). This hook subscribes once and partitions the array into the seven
 * typed buckets in a SINGLE pass.
 *
 * The per-type mapping is copied verbatim from `queries.ts` so the bucket
 * contents are byte-identical to the legacy hooks. Those legacy hooks are
 * intentionally kept — they have external consumers (arena split view,
 * automations assistant chat) — so this is additive, not a replacement.
 *
 * The returned field names match the params of `useMergedChatItems`, so it can
 * be spread directly: `useMergedChatItems({ messages, ...approvals })`.
 */
export function useThreadApprovals(
  organizationId: string,
  threadId: string | undefined,
): ThreadApprovals {
  const { approvals, isLoading } = useActiveApprovals(organizationId);

  const buckets = useMemo(() => {
    const integrationApprovals: IntegrationApproval[] = [];
    const workflowCreationApprovals: WorkflowCreationApproval[] = [];
    const workflowUpdateApprovals: WorkflowUpdateApproval[] = [];
    const workflowRunApprovals: WorkflowRunApproval[] = [];
    const humanInputRequests: HumanInputRequest[] = [];
    const locationRequests: LocationRequest[] = [];
    const documentWriteApprovals: DocumentWriteApproval[] = [];
    const knowledgeWriteApprovals: KnowledgeWriteApproval[] = [];
    const planApprovals: PlanApproval[] = [];
    const humanControlRequests: HumanControlRequest[] = [];

    if (approvals && threadId) {
      for (const a of approvals) {
        if (a.threadId !== threadId || a.metadata === undefined) continue;

        switch (a.resourceType) {
          case 'integration_operation':
            integrationApprovals.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as IntegrationOperationMetadata,
              executedAt: a.executedAt,
              executionError: a.executionError,
              _creationTime: a._creationTime,
              messageId: a.messageId,
            });
            break;
          case 'workflow_creation':
            workflowCreationApprovals.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as WorkflowCreationMetadata,
              executedAt: a.executedAt,
              executionError: a.executionError,
              _creationTime: a._creationTime,
              messageId: a.messageId,
            });
            break;
          case 'workflow_update':
            workflowUpdateApprovals.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as WorkflowUpdateMetadata,
              executedAt: a.executedAt,
              executionError: a.executionError,
              _creationTime: a._creationTime,
              messageId: a.messageId,
            });
            break;
          case 'workflow_run':
            workflowRunApprovals.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as WorkflowRunMetadata,
              executedAt: a.executedAt,
              executionError: a.executionError,
              _creationTime: a._creationTime,
              messageId: a.messageId,
            });
            break;
          case 'human_input_request':
            humanInputRequests.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as HumanInputRequestMetadata,
              _creationTime: a._creationTime,
              messageId: a.messageId,
              wfExecutionId: a.wfExecutionId
                ? toId<'wfExecutions'>(a.wfExecutionId)
                : undefined,
            });
            break;
          case 'location_request':
            locationRequests.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as LocationRequestMetadata,
              _creationTime: a._creationTime,
              messageId: a.messageId,
              wfExecutionId: a.wfExecutionId
                ? toId<'wfExecutions'>(a.wfExecutionId)
                : undefined,
            });
            break;
          case 'document_write':
            documentWriteApprovals.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              metadata: normalizeDocumentWriteMetadata(
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
                a.metadata as unknown as DocumentWriteMetadata,
              ),
              executedAt: a.executedAt,
              executionError: a.executionError,
              _creationTime: a._creationTime,
              messageId: a.messageId,
            });
            break;
          case 'knowledge_write':
            knowledgeWriteApprovals.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as KnowledgeWriteMetadata,
              executedAt: a.executedAt,
              executionError: a.executionError,
              _creationTime: a._creationTime,
              messageId: a.messageId,
            });
            break;
          case 'external_agent_plan':
            planApprovals.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as PlanApprovalMetadata,
              _creationTime: a._creationTime,
              messageId: a.messageId,
            });
            break;
          case 'external_agent_human_control':
            humanControlRequests.push({
              _id: toId<'approvals'>(a._id),
              status: a.status,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
              metadata: a.metadata as unknown as HumanControlMetadata,
              _creationTime: a._creationTime,
              messageId: a.messageId,
            });
            break;
          default:
            break;
        }
      }
    }

    return {
      integrationApprovals,
      workflowCreationApprovals,
      workflowUpdateApprovals,
      workflowRunApprovals,
      humanInputRequests,
      locationRequests,
      documentWriteApprovals,
      knowledgeWriteApprovals,
      planApprovals,
      humanControlRequests,
    };
    // `isLoading` is intentionally excluded from the deps below: it's a cheap
    // passthrough, so re-partitioning when it toggles would be wasted work.
  }, [approvals, threadId]);

  return { ...buckets, isLoading };
}
