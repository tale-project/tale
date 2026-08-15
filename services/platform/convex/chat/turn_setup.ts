/**
 * The turn's opening write — one internal mutation, one transaction.
 *
 * A turn used to open with three sequential `ctx.runMutation` syscalls from
 * the node action (append the user message, append the assistant placeholder,
 * begin the generation row). The backend re-validates the caller's JWT on
 * EVERY callback that carries one, so the "Setup before model" wait the
 * message-info panel reports was three validations deep — merging the writes
 * makes it one. The merge is also a correctness fix: the three writes commit
 * atomically, so a failure can no longer strand a user message whose reply
 * will never arrive, or an empty placeholder with no generation row (a state
 * `recoverStaleDirectGenerations` cannot see, since it walks generations).
 *
 * The transaction bodies are the SAME functions the standalone mutations run
 * (`messages.appendMessageToThread`, `generations.beginGenerationForThread`)
 * — sequence assignment, thread/branch-root freshness stamps, the
 * first-message title schedule, and the generation reset-or-insert cannot
 * drift between the merged and the standalone paths.
 *
 * Internal because it is the trusted lower half of a turn: the node action
 * authenticates the caller and resolves the organization before it writes.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { beginGenerationForThread } from './generations';
import { appendMessageToThread } from './messages';

export const beginTurnInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    /** The user turn's parts. Absent on a regenerate — the trailing user row
     * already exists and the turn only re-answers it. */
    userParts: v.optional(v.any()),
    /** Silent stamp: context assembly dropped older history for this turn. */
    truncation: v.optional(v.object({ droppedMessages: v.number() })),
  },
  returns: v.object({
    userMessage: v.optional(
      v.object({ id: v.id('messages'), sequence: v.number() }),
    ),
    assistantMessage: v.object({
      id: v.id('messages'),
      sequence: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const userMessage =
      args.userParts !== undefined
        ? await appendMessageToThread(ctx, {
            organizationId: args.organizationId,
            threadId: args.threadId,
            role: 'user',
            parts: args.userParts,
          })
        : undefined;
    const assistantMessage = await appendMessageToThread(ctx, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      role: 'assistant',
      parts: [],
      ...(args.truncation !== undefined ? { truncation: args.truncation } : {}),
    });
    await beginGenerationForThread(ctx, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      messageId: assistantMessage.id,
    });
    return {
      ...(userMessage !== undefined ? { userMessage } : {}),
      assistantMessage,
    };
  },
});
