/**
 * Type-safe function references for members module.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from './create_ref';

export type GetMemberRoleInternalRef = FunctionReference<
  'query',
  'internal',
  { userId: string; organizationId: string },
  string | null
>;

export function getGetMemberRoleInternalRef(): GetMemberRoleInternalRef {
  return createRef<GetMemberRoleInternalRef>('internal', ['members', 'queries', 'getMemberRoleInternal']);
}
