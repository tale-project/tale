/**
 * Convex Tool: Propose Memory (non-blocking, user-confirmed)
 *
 * Lets the agent stage a fact about the user that should persist across
 * future conversations. The proposal lands in the `userMemories` table
 * with `status='pending'` and a 24h TTL — it never enters the live
 * retrieval pool until the user explicitly approves it (Save / Edit&Save
 * in the chat inline card or settings/Pending tab).
 *
 * Hard contract — non-blocking:
 *  - Writes the pending row, returns to the model immediately.
 *  - Does NOT touch the platform `approvals` table (that's a workflow gate
 *    that pauses the agent). Conversation continues normally.
 *  - Does NOT change `threadMetadata.generationStatus` / "waiting for input"
 *    state. The user's next message is never blocked by an outstanding
 *    proposal.
 *  - If the user ignores the card, the row is hard-deleted by the lazy
 *    cleanup once `pendingExpiresAt` passes — zero lasting effect.
 *
 * Rate limits: at most 3 pending entries per thread, and at most 20
 * proposals per (userId, organizationId) per 24h. Over either cap, the
 * tool returns a "denied" outcome and audit-logs the rejection so admins
 * can see attempt counts (no content stored).
 *
 * Content guardrails: ≤ 200 tokens, no newlines / `<` / backticks /
 * control characters (these defenses harden against MINJA-class memory-
 * poisoning attacks; the structural defense is the user-confirmation
 * gate, but lightening the surface still helps).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { ConvexError } from 'convex/values';
import { z } from 'zod/v4';

import { isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';

const PENDING_PER_THREAD_CAP = 3;
const PROPOSALS_PER_DAY_CAP = 20;
const MEMORY_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

interface ProposeResult {
  ok: boolean;
  message: string;
}

function readCtxField(ctx: ToolCtx, key: string): unknown {
  if (!isRecord(ctx)) return undefined;
  return ctx[key];
}

function readStringContextField(ctx: ToolCtx, key: string): string | undefined {
  const value = readCtxField(ctx, key);
  return typeof value === 'string' ? value : undefined;
}

export const proposeMemoryTool: ToolDefinition = {
  name: 'propose_memory',
  tool: createTool({
    description:
      'Propose a fact about the user that should be remembered across ' +
      'future conversations. The user must approve the proposal before it ' +
      'influences future responses; you are not directly modifying memory. ' +
      'Use sparingly — only for stable preferences, identifiers, or facts ' +
      'the user explicitly told you to remember. Keep entries to a single ' +
      'short sentence.',
    inputSchema: z.object({
      content: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          'A short, single-line fact about the user, written in plain text. ' +
            'No newlines, no angle brackets, no backticks. Will be shown ' +
            'verbatim to the user for approval.',
        ),
    }),
    execute: async (ctx: ToolCtx, args): Promise<ProposeResult> => {
      const userId = readStringContextField(ctx, 'userId');
      const organizationId = readStringContextField(ctx, 'organizationId');
      const threadId = readStringContextField(ctx, 'threadId');
      const messageId = readStringContextField(ctx, 'messageId');
      if (!userId || !organizationId || !threadId) {
        return {
          ok: false,
          message:
            'Memory proposals require chat context (user, org, thread). ' +
            'This call ran in a context where one of those is missing.',
        };
      }

      try {
        const result = await ctx.runMutation(
          internal.user_memories.internal_mutations.writeProposal,
          {
            userId,
            organizationId,
            threadId,
            messageId,
            content: args.content,
            pendingTtlMs: MEMORY_PENDING_TTL_MS,
            perThreadCap: PENDING_PER_THREAD_CAP,
            perDayCap: PROPOSALS_PER_DAY_CAP,
          },
        );
        if (!result.ok) {
          return {
            ok: false,
            message: result.reason,
          };
        }
        return {
          ok: true,
          message:
            'Proposal queued. The user will see a card to approve or ' +
            'dismiss; the memory will not affect responses until they ' +
            'approve.',
        };
      } catch (err) {
        if (err instanceof ConvexError) {
          const data = err.data;
          const message =
            isRecord(data) && typeof data['message'] === 'string'
              ? data['message']
              : String(err);
          return { ok: false, message };
        }
        console.error('[propose_memory] failed', err);
        return {
          ok: false,
          message: 'Failed to queue memory proposal due to an internal error.',
        };
      }
    },
  }),
} as const;
