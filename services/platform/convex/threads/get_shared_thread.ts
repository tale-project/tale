import { v } from 'convex/values';

import { query } from '../_generated/server';
import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getThreadMessages } from './get_thread_messages';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getSharedThread = query({
  args: {
    shareToken: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    if (!UUID_REGEX.test(args.shareToken)) {
      return null;
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', args.shareToken))
      .first();

    if (!metadata || !metadata.isShared) {
      return null;
    }

    // Status gate: the share token survives delete/trash/expire (delete
    // does not clear `shareToken`/`isShared`/`sharedAt`/`sharedBy`), so
    // without this check a share-token holder still reads a thread the
    // owner has trashed or that retention has marked expired. Trashed
    // and expired shares have no UI affordance anywhere; pretend the
    // share doesn't exist. A future "share trashed/expired" feature
    // would relax this.
    if (
      metadata.status === 'trashed' ||
      metadata.status === 'expired' ||
      metadata.status === 'deleted'
    ) {
      return null;
    }

    // Org-scoped access: if the thread has an organizationId, verify membership
    if (metadata.organizationId) {
      const isMember = await isOrgMember(
        ctx,
        authUser.userId,
        metadata.organizationId,
      );
      if (!isMember) {
        return null;
      }
    }

    const { messages: allMessages } = await getThreadMessages(
      ctx,
      metadata.threadId,
    );

    // Snapshot: only include messages up to the share timestamp
    const sharedAt = metadata.sharedAt;
    const messages = sharedAt
      ? allMessages.filter((m) => m._creationTime <= sharedAt)
      : allMessages;

    return {
      threadId: metadata.threadId,
      title: metadata.title,
      createdAt: metadata.createdAt,
      sharedBy: metadata.sharedBy,
      agentSlug: metadata.agentSlug ?? null,
      messages,
    };
  },
});
