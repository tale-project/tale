/**
 * Get approval by ID
 */

import { QueryCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { ApprovalItem } from './types';

export async function getApproval(
  ctx: QueryCtx,
  approvalId: Id<'approvals'>,
): Promise<ApprovalItem | null> {
  return await ctx.db.get(approvalId);
}
