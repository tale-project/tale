/**
 * Type-safe function references for approvals module.
 */

import type { FunctionReference } from 'convex/server';
import type { Id } from '../../_generated/dataModel';
import { createRef } from './create_ref';

export type GetApprovalsForThreadInternalRef = FunctionReference<
  'query',
  'internal',
  { threadId: string },
  Array<{
    _id: Id<'approvals'>;
    _creationTime: number;
    status: string;
    toolName?: string;
    actionType?: string;
    data?: unknown;
    question?: string;
    format?: string;
    options?: Array<{ label: string; description?: string; value?: string }>;
    response?: unknown;
    messageId?: string;
  }>
>;

export type MarkApprovalsAsProcessedRef = FunctionReference<
  'mutation',
  'internal',
  { approvalIds: Array<Id<'approvals'>> },
  void
>;

export type LinkApprovalsToMessageRef = FunctionReference<
  'mutation',
  'internal',
  { threadId: string; messageId: string },
  number
>;

export function getGetApprovalsForThreadInternalRef(): GetApprovalsForThreadInternalRef {
  return createRef<GetApprovalsForThreadInternalRef>('internal', ['approvals', 'queries', 'getApprovalsForThreadInternal']);
}

export function getMarkApprovalsAsProcessedRef(): MarkApprovalsAsProcessedRef {
  return createRef<MarkApprovalsAsProcessedRef>('internal', ['approvals', 'mutations', 'markApprovalsAsProcessed']);
}

export function getLinkApprovalsToMessageRef(): LinkApprovalsToMessageRef {
  return createRef<LinkApprovalsToMessageRef>('internal', ['approvals', 'mutations', 'linkApprovalsToMessage']);
}
