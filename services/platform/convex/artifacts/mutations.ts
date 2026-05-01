import { v } from 'convex/values';
import { ConvexError } from 'convex/values';

import { mutation } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';

const MAX_USER_EDIT_BYTES = 1_000_000;

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
    await getOrganizationMember(ctx, artifact.organizationId, authUser);

    if (args.content.length > MAX_USER_EDIT_BYTES) {
      throw new ConvexError({
        code: 'too_large',
        message: `Artifact content exceeds ${MAX_USER_EDIT_BYTES} bytes.`,
      });
    }

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
