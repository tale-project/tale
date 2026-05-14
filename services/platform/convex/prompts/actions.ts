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
    content: v.string(),
    description: v.optional(v.string()),
    scope: promptScopeValidator,
    teamId: v.optional(v.string()),
    category: v.optional(v.string()),
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
      tags: args.tags,
    });

    // Try AI-generated title first (10s timeout enforced in the action)
    const aiTitle = await ctx.runAction(
      internal.prompts.generate_title.generatePromptTitle,
      { content: args.content },
    );

    const title = aiTitle?.trim() || generateFallbackTitle();

    return await ctx.runMutation(api.prompts.mutations.createPrompt, {
      organizationId: args.organizationId,
      title,
      content: args.content,
      description: args.description,
      scope: args.scope,
      teamId: args.teamId,
      category: args.category,
      tags: args.tags,
      sourceMessageId: args.sourceMessageId,
    });
  },
});
