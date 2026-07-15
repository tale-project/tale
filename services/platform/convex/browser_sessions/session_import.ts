import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireInstanceAdmin } from '../deployment/auth';
import { encryptString } from '../lib/crypto/encrypt_string';
import { DEFAULT_SESSION_TTL_MS } from './sessions';

/**
 * Import a warmed browser session into the pool — the human-assisted path: an
 * operator solves the bot challenge in a real browser, exports the site's
 * cookie jar (Netscape format), and pastes it here with the target `domain`.
 * Deployment-operator gated (write). The jar is encrypted at rest and never
 * returned.
 *
 * Kept in its own file (not alongside the mutations it calls) to avoid the
 * Convex api-type poisoning that a same-file action→internalMutation reference
 * triggers.
 */
export const importBrowserSession = action({
  args: {
    // The org this session belongs to. Sessions are per-org (see schema.ts's
    // tenant-isolation invariant): a claim only ever returns the owning org's
    // sessions, so a warmed jar is imported FOR a specific organization.
    organizationId: v.string(),
    domain: v.string(),
    cookiesJar: v.string(),
    userAgent: v.optional(v.string()),
    visitorData: v.optional(v.string()),
    poToken: v.optional(v.string()),
    label: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  returns: v.object({ sessionId: v.id('browserSessions') }),
  // Explicit return annotation breaks the inference cycle: the handler calls
  // `internal.…insertBrowserSession`, and `internal` includes this action, so
  // inferring the return through `internal` would reference the action in its
  // own initializer — the api-type poisoning. Annotating it stops the inference.
  handler: async (ctx, args): Promise<{ sessionId: Id<'browserSessions'> }> => {
    const auth = await requireInstanceAdmin(ctx, { write: true });
    const jar = args.cookiesJar.trim();
    const domain = args.domain.trim().toLowerCase();
    if (!jar || !domain) {
      throw new ConvexError({
        code: 'INVALID_SESSION',
        message: 'A domain and a non-empty cookie jar are required.',
      });
    }
    const cookiesEncrypted = await encryptString(jar);
    const organizationId = args.organizationId.trim();
    if (!organizationId) {
      throw new ConvexError({
        code: 'INVALID_SESSION',
        message: 'An organizationId is required (sessions are per-org).',
      });
    }
    const sessionId = await ctx.runMutation(
      internal.browser_sessions.sessions.insertBrowserSession,
      {
        organizationId,
        domain,
        cookiesEncrypted,
        ...(args.userAgent !== undefined && { userAgent: args.userAgent }),
        ...(args.visitorData !== undefined && {
          visitorData: args.visitorData,
        }),
        ...(args.poToken !== undefined && { poToken: args.poToken }),
        ...(args.label !== undefined && { label: args.label }),
        expiresAt: Date.now() + (args.ttlMs ?? DEFAULT_SESSION_TTL_MS),
        createdBy: auth.userId,
      },
    );
    return { sessionId };
  },
});
