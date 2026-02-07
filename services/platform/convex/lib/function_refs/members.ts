/**
 * Type-safe function references for members module.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from './create_ref';

export type GetMemberRoleRef = FunctionReference<
  'query',
  'internal',
  { userId: string; organizationId: string },
  string | null
>;

export function getGetMemberRoleRef(): GetMemberRoleRef {
  return createRef<GetMemberRoleRef>('internal', ['members', 'queries', 'getMemberRole']);
}
