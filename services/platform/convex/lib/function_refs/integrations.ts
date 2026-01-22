/**
 * Type-safe function references for integrations module.
 */

import type { FunctionReference } from 'convex/server';
import type { Doc } from '../../_generated/dataModel';
import { createRef } from './create_ref';

export type GetBasicInfoInternalRef = FunctionReference<
  'query',
  'internal',
  { integrationId: string },
  { name: string; type: string; title?: string; description?: string } | null
>;

export type ListIntegrationsInternalRef = FunctionReference<
  'query',
  'internal',
  { organizationId: string; name?: string },
  Doc<'integrations'>[]
>;

export function getGetBasicInfoInternalRef(): GetBasicInfoInternalRef {
  return createRef<GetBasicInfoInternalRef>('internal', ['integrations', 'queries', 'getBasicInfoInternal']);
}

export function getListIntegrationsInternalRef(): ListIntegrationsInternalRef {
  return createRef<ListIntegrationsInternalRef>('internal', ['integrations', 'queries', 'listInternal']);
}
