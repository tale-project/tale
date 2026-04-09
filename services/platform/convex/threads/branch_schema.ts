import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const threadBranchesTable = defineTable({
  rootThreadId: v.string(),
  branchThreadId: v.string(),
  parentThreadId: v.string(),
  forkAfterMessageId: v.string(),
  forkOrder: v.number(),
  branchIndex: v.number(),
  createdAt: v.number(),
})
  .index('by_rootThreadId', ['rootThreadId'])
  .index('by_parentThreadId_forkAfterMessageId', [
    'parentThreadId',
    'forkAfterMessageId',
  ])
  .index('by_branchThreadId', ['branchThreadId']);
