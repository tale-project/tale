import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

// `fetchDocumentComparisonByStorageIds` lived under
// `convex/agent_tools/documents/helpers/`, moved out wholesale with the rest
// of the tool-calling/subagent plane. `compareDocuments` is a user-triggered
// action (the Document Hub diff view), so it keeps its established
// `ConvexError`-on-failure convention (see the auth/membership/ownership
// checks below, all preserved — none of them are AI-related) and now also
// throws for the comparison itself instead of silently returning nothing.

export const compareDocuments = action({
  args: {
    organizationId: v.string(),
    baseStorageId: v.string(),
    baseFileName: v.string(),
    comparisonStorageId: v.string(),
    comparisonFileName: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const isMember = await ctx.runQuery(
      internal.documents.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: authUser.userId,
      },
    );
    if (!isMember) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Unauthorized: not a member of this organization',
      });
    }

    // Convex `_storage` is global — membership in args.organizationId is
    // not by itself enough; verify each storage id is owned by a
    // fileMetadata row in this org. Without this gate, any org member
    // can supply another org's storage ids and read its files via the
    // diff endpoint (cross-tenant IDOR).
    const ownsStorage = await ctx.runQuery(
      internal.documents.internal_queries.verifyStorageIdsBelongToOrg,
      {
        organizationId: args.organizationId,
        storageIds: [args.baseStorageId, args.comparisonStorageId],
      },
    );
    if (!ownsStorage) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message:
          'Unauthorized: one or more storage ids do not belong to this organization',
      });
    }
    // FOLLOW-UP / round-2 M5: this gate is org-level, not team-ACL-level.
    // A same-org user who does NOT have access to a team-scoped document
    // can still diff it via this path. The fix requires plumbing
    // `userTeamIds` + `hasTeamAccess(doc, userTeamIds)` per storage id
    // (mirror `folders/mutations.ts`). Tracked as a separate issue
    // because the team-ACL scaffold is partially in place but not
    // consistently applied to all document read paths yet.

    throw new ConvexError(
      'Document comparison is offline while the platform AI backend is rewritten.',
    );
  },
});
