import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { fetchDocumentComparisonByUrls } from '../agent_tools/documents/helpers/fetch_document_comparison';
import { authComponent } from '../auth';
import { toId } from '../lib/type_cast_helpers';

export const compareDocuments = action({
  args: {
    organizationId: v.string(),
    baseStorageId: v.string(),
    baseFileName: v.string(),
    comparisonStorageId: v.string(),
    comparisonFileName: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const isMember = await ctx.runQuery(
      internal.documents.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
      },
    );
    if (!isMember) {
      throw new Error('Unauthorized: not a member of this organization');
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
      throw new Error(
        'Unauthorized: one or more storage ids do not belong to this organization',
      );
    }
    // FOLLOW-UP / round-2 M5: this gate is org-level, not team-ACL-level.
    // A same-org user who does NOT have access to a team-scoped document
    // can still diff it via this path. The fix requires plumbing
    // `userTeamIds` + `hasTeamAccess(doc, userTeamIds)` per storage id
    // (mirror `folders/mutations.ts`). Tracked as a separate issue
    // because the team-ACL scaffold is partially in place but not
    // consistently applied to all document read paths yet.

    const [baseFileUrl, compFileUrl] = await Promise.all([
      resolveStorageUrl(ctx, args.baseStorageId),
      resolveStorageUrl(ctx, args.comparisonStorageId),
    ]);

    return await fetchDocumentComparisonByUrls(
      baseFileUrl,
      args.baseFileName,
      compFileUrl,
      args.comparisonFileName,
    );
  },
});

async function resolveStorageUrl(
  ctx: { storage: { getUrl: (id: string) => Promise<string | null> } },
  storageId: string,
): Promise<string> {
  const fileUrl = await ctx.storage.getUrl(toId<'_storage'>(storageId));
  if (!fileUrl) {
    throw new Error(`File URL not available for storage ID: ${storageId}`);
  }
  return fileUrl;
}
