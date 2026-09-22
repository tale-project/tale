import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';

/**
 * The person's custom instructions for the turn's prompt, or `undefined`.
 *
 * The seam answers the already-gated text (the person's toggle over the org
 * default, blank as none — `getEffectiveCustomInstructions`), so the turn
 * carries no preference logic of its own. A failed read degrades to "no
 * instructions" with a warning rather than refusing the turn: the person's
 * preferences row is a convenience layer on the conversation, and a hiccup
 * there must never brick chat — the same posture the policy reads take.
 */
export async function readCustomInstructions(
  ctx: ActionCtx,
  args: { organizationId: string; userId: string },
): Promise<string | undefined> {
  try {
    const text: unknown = await ctx.runQuery(
      internal.user_preferences.queries.getCustomInstructionsInternal,
      { organizationId: args.organizationId, userId: args.userId },
    );
    return typeof text === 'string' && text.length > 0 ? text : undefined;
  } catch (error) {
    console.warn(
      `[chat] custom instructions unavailable for user ${args.userId} in organization ${args.organizationId} — replying without them:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}
