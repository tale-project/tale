'use node';

/**
 * Public actions for prompt templates.
 *
 * `savePrompt` generates a title via AI (with a 10s timeout) and falls back to
 * a PROMPT-XXXXX id on timeout/error, then creates the prompt via the standard
 * `createPrompt` mutation.
 */

import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { promptScopeValidator, promptTemplateValidator } from './validators';

function generateFallbackTitle(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const randomId = Array.from(
    { length: 5 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('');
  return `PROMPT-${randomId}`;
}

export const savePrompt = action({
  args: {
    organizationId: v.string(),
    /**
     * Optional user-supplied title. When omitted or blank, the action
     * AI-generates one (with a 10s timeout) and falls back to a
     * PROMPT-XXXXX id on timeout/error. Lets the same action serve both
     * the chat "save as prompt" affordance and the library "create
     * prompt" form (where the user may or may not supply a title).
     */
    title: v.optional(v.string()),
    content: v.string(),
    description: v.optional(v.string()),
    scope: promptScopeValidator,
    teamId: v.optional(v.string()),
    /** Legacy free-form category string. Lazy-migrated by the mutation. */
    category: v.optional(v.string()),
    /** Preferred. References an existing `promptCategories` row. */
    categoryId: v.optional(v.id('promptCategories')),
    tags: v.optional(v.array(v.string())),
    sourceMessageId: v.optional(v.string()),
  },
  returns: promptTemplateValidator,
  handler: async (ctx, args): Promise<Doc<'promptTemplates'>> => {
    // Cheap auth gate first — anything more expensive lives behind it.
    await requireAuthenticatedUser(ctx);

    // Fail-fast pre-flight: validate org/team membership and size caps
    // BEFORE the LLM call so a wrong organizationId / oversize content
    // doesn't burn provider tokens. The downstream mutation re-validates
    // everything and is the sole consumer of the `prompt:create` rate-limit
    // token — keep this side cheap and non-consuming.
    await ctx.runQuery(internal.prompts.queries.validateSaveArgs, {
      organizationId: args.organizationId,
      content: args.content,
      description: args.description,
      scope: args.scope,
      teamId: args.teamId,
      category: args.category,
      categoryId: args.categoryId,
      tags: args.tags,
    });

    // Honour a user-supplied title; otherwise AI-generate. Skip the LLM
    // call entirely when the caller already has a title — saves tokens
    // and the 10s timeout window on the library "create" path where the
    // user typed one themselves.
    const userTitle = args.title?.trim();
    let title: string;
    if (userTitle) {
      title = userTitle;
    } else {
      const aiTitle = await ctx.runAction(
        internal.prompts.generate_title.generatePromptTitle,
        { content: args.content },
      );
      title = aiTitle?.trim() || generateFallbackTitle();
    }

    return await ctx.runMutation(api.prompts.mutations.createPrompt, {
      organizationId: args.organizationId,
      title,
      content: args.content,
      description: args.description,
      scope: args.scope,
      teamId: args.teamId,
      category: args.category,
      categoryId: args.categoryId,
      tags: args.tags,
      sourceMessageId: args.sourceMessageId,
    });
  },
});
