/**
 * Type-safe function references for approvals module.
 */

import type { FunctionReference } from 'convex/server';
import type { Id } from '../../_generated/dataModel';
import { createRef } from './create_ref';

export type GetApprovalsForThreadRef = FunctionReference<
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

export type LinkApprovalsToMessageRef = FunctionReference<
  'mutation',
  'internal',
  { threadId: string; messageId: string },
  number
>;

export function getGetApprovalsForThreadRef(): GetApprovalsForThreadRef {
  return createRef<GetApprovalsForThreadRef>('internal', ['approvals', 'queries', 'getApprovalsForThread']);
}

export function getLinkApprovalsToMessageRef(): LinkApprovalsToMessageRef {
  return createRef<LinkApprovalsToMessageRef>('internal', ['approvals', 'internal_mutations', 'linkApprovalsToMessage']);
}
