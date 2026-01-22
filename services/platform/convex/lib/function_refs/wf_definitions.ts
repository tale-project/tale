/**
 * Type-safe function references for workflow definitions module.
 */

import type { FunctionReference } from 'convex/server';
import type { Id } from '../../_generated/dataModel';
import { createRef } from './create_ref';

export type GetWorkflowInternalRef = FunctionReference<
  'query',
  'internal',
  { wfDefinitionId: Id<'wfDefinitions'> },
  { name: string; description?: string } | null
>;

export function getGetWorkflowInternalRef(): GetWorkflowInternalRef {
  return createRef<GetWorkflowInternalRef>('internal', ['wf_definitions', 'queries', 'getWorkflowInternal']);
}
