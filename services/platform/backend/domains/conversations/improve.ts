import type { Sql } from 'postgres';

import { EmptyReplyError } from '../../core/automations_builder/chat_wire';
import { createBuilderModel } from '../../core/automations_builder/model_call';
import {
  pickDirectModel,
  type PreferredChatModel,
} from '../../core/chat/generate_title';
import type { ActionCtx } from '../../core/lib/ctx';
import { internal } from '../../core/lib/handler_names';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { createPgUsageLedger } from '../chat/store.ts';
import { ConversationError } from './service.ts';

/**
 * The Inbox composer's "Improve with AI": one bounded direct model call that
 * rewrites the draft, on the same lane the thread-title call runs — the
 * writer's sticky chat model when a direct credential serves it, else the
 * first servable catalog model — booked to the usage ledger under its own
 * agent slug. Nothing is stored: the caller shows the rewrite beside the
 * original and the person accepts or rejects it.
 */

/** The agent slug the rewrite books its tokens under. */
export const IMPROVE_AGENT_SLUG = 'inbox-improve';
/** A rewrite outlives no one's patience past this. */
const IMPROVE_TIMEOUT_MS = 20_000;
/** A reply is a few paragraphs; a rewrite is never longer than that. */
const IMPROVE_MAX_OUTPUT_TOKENS = 1_500;
/** Enough draft to rewrite; never a whole document. */
export const IMPROVE_MAX_INPUT_CHARS = 20_000;
export const IMPROVE_MAX_INSTRUCTION_CHARS = 2_000;
/** Editing is mechanical — keep the sampling tight. */
const IMPROVE_TEMPERATURE = 0.3;

const IMPROVE_INSTRUCTIONS = `You improve a reply a support agent is about to send to a customer.

Rewrite the draft below so it reads clearly and professionally.
- Keep every fact, commitment, number, name and link exactly as written; add nothing the draft does not say
- Keep the draft's language, tone and level of formality unless the instruction asks otherwise
- Keep the draft's structure (greeting, paragraphs, sign-off) unless the instruction asks otherwise
- Follow the agent's instruction when one is given
- Return ONLY the improved reply, as Markdown, with no preamble or commentary`;

export interface ImproveMessageArgs {
  organizationId: string;
  userId: string;
  originalMessage: string;
  instruction?: string;
}

/** The two-message prompt: the rule set, then the draft (and instruction). */
export function buildImprovePrompt(args: {
  originalMessage: string;
  instruction?: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const instruction = args.instruction?.trim();
  const draft = args.originalMessage.slice(0, IMPROVE_MAX_INPUT_CHARS);
  const user =
    instruction === undefined || instruction.length === 0
      ? `Draft:\n\n${draft}`
      : `Instruction: ${instruction.slice(0, IMPROVE_MAX_INSTRUCTION_CHARS)}\n\nDraft:\n\n${draft}`;
  return [
    { role: 'system', content: IMPROVE_INSTRUCTIONS },
    { role: 'user', content: user },
  ];
}

/**
 * Rewrites the draft. Refuses with `IMPROVE_UNAVAILABLE` (409) when no
 * direct-credentialed provider can serve a model in this organization, and
 * with `IMPROVE_FAILED` (502) when the provider answered nothing usable.
 */
export async function improveConversationMessage(
  sql: Sql,
  args: ImproveMessageArgs,
): Promise<{ improvedMessage: string }> {
  if (args.originalMessage.trim().length === 0) {
    throw new ConversationError(
      'IMPROVE_EMPTY',
      'There is no draft to improve',
      400,
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused title lane; every ctx facility it touches is covered by chatShimHandlers
  const ctx = createCtxShim(chatShimHandlers(sql)) as unknown as ActionCtx;
  const preferred: PreferredChatModel | null = await ctx.runQuery(
    internal.user_preferences.queries.getChatModelInternal,
    { userId: args.userId, organizationId: args.organizationId },
  );
  const target = await pickDirectModel(ctx, args.organizationId, preferred);
  if (target === null) {
    throw new ConversationError(
      'IMPROVE_UNAVAILABLE',
      'No AI provider can rewrite messages in this organization yet — connect one under Settings › AI providers',
      409,
    );
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), IMPROVE_TIMEOUT_MS);
  const ledger = createPgUsageLedger(sql);
  const book = async (usage: { prompt: number; completion: number }) => {
    // The call happened whether or not the reply was usable — the org paid
    // for it. Best-effort: a ledger failure must not cost the rewrite.
    await ledger
      .record({
        organizationId: args.organizationId,
        userId: args.userId,
        agentSlug: IMPROVE_AGENT_SLUG,
        model: target.modelId,
        provider: target.providerSlug,
        inputTokens: usage.prompt,
        outputTokens: usage.completion,
        totalTokens: usage.prompt + usage.completion,
      })
      .catch((error: unknown) => {
        console.warn('[improveConversationMessage] usage write failed:', error);
      });
  };
  try {
    const model = createBuilderModel(ctx, {
      organizationId: args.organizationId,
      target,
      maxTokens: IMPROVE_MAX_OUTPUT_TOKENS,
      signal: deadline.signal,
    });
    const reply = await model({
      messages: buildImprovePrompt(args),
      temperature: IMPROVE_TEMPERATURE,
      turn: 1,
    });
    if (reply.usage !== undefined) await book(reply.usage);
    const improved = reply.content.trim();
    if (improved.length === 0) {
      throw new ConversationError(
        'IMPROVE_FAILED',
        'The model answered with an empty rewrite — try again',
        502,
      );
    }
    return { improvedMessage: improved };
  } catch (error) {
    if (error instanceof ConversationError) throw error;
    if (error instanceof EmptyReplyError && error.usage !== undefined) {
      await book(error.usage);
    }
    console.error('[improveConversationMessage] model call failed:', error);
    throw new ConversationError(
      'IMPROVE_FAILED',
      deadline.signal.aborted
        ? `The rewrite took longer than ${Math.round(IMPROVE_TIMEOUT_MS / 1000)}s — try again`
        : 'The AI provider could not rewrite the message — try again',
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}
