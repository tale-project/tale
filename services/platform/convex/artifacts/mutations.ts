import { v } from 'convex/values';
import { ConvexError } from 'convex/values';

import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { assertContentSize } from './internal_mutations';

export const userEdit = mutation({
  args: {
    artifactId: v.id('artifacts'),
    content: v.string(),
  },
  returns: v.object({ revision: v.number() }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Artifact not found.',
      });
    }
    const metadata = await assertThreadAccess(ctx, artifact.threadId, authUser);
    if (metadata.organizationId !== artifact.organizationId) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Not authorized to access this thread.',
      });
    }

    if (artifact.liveStreamMode !== undefined) {
      throw new ConvexError({
        code: 'streaming',
        message: 'Cannot edit while the agent is streaming this artifact.',
      });
    }

    assertContentSize(args.content);

    if (args.content === artifact.content) {
      return { revision: artifact.revision };
    }

    const nextRevision = artifact.revision + 1;
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      content: args.content,
      revision: nextRevision,
      lastEditedByMessageId: undefined,
      updatedAt: now,
    });
    await ctx.db.insert('artifactRevisions', {
      artifactId: args.artifactId,
      revision: nextRevision,
      content: args.content,
      editedByMessageId: undefined,
      editKind: 'user',
      createdAt: now,
    });
    return { revision: nextRevision };
  },
});
