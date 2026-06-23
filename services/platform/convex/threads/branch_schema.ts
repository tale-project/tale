import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const threadBranchesTable = defineTable({
  rootThreadId: v.string(),
  branchThreadId: v.string(),
  parentThreadId: v.string(),
  forkAfterMessageId: v.string(),
  forkOrder: v.number(),
  /**
   * The `_creationTime` of the message at `forkOrder` — i.e. WHEN the branch
   * diverged from its parent, expressed as a timestamp. The Canvas/Plan panes
   * union a branch's whole ancestor lineage; this lets them cut each ancestor's
   * artifacts at the fork point (`threadFiles.createdAt <= forkOrderCreatedAt`),
   * so a file the parent wrote AFTER the branch split off doesn't leak onto the
   * branch. Optional + additive: branches created before this field skip the
   * cut and fall back to unioning the whole ancestor (prior behaviour).
   */
  forkOrderCreatedAt: v.optional(v.number()),
  branchIndex: v.number(),
  createdAt: v.number(),
})
  .index('by_rootThreadId', ['rootThreadId'])
  .index('by_parentThreadId_forkAfterMessageId', [
    'parentThreadId',
    'forkAfterMessageId',
  ])
  .index('by_branchThreadId', ['branchThreadId']);
