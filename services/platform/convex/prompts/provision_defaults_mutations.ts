/**
 * DB half of the default-prompt provisioner (V8; the file reads live in
 * `provision_defaults.ts`, a node action).
 *
 * Seeded prompts are CREATE-ONCE: the `promptDefaultProvisions` row records
 * that an org already received a given default prompt, so an org that later
 * edits or deletes the seeded prompt is never re-provisioned behind its back.
 * Mirrors `workflows/provision_defaults_mutations.ts`.
 */

import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';
import { assertPromptSizes, normalizePromptFields } from './size_guards';
import { buildInitialVersionEntry } from './version_history';

export const getPromptProvision = internalQuery({
  args: { organizationId: v.string(), promptSlug: v.string() },
  returns: v.union(v.null(), v.object({ contentHash: v.string() })),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('promptDefaultProvisions')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('promptSlug', args.promptSlug),
      )
      .first();
    return row ? { contentHash: row.contentHash } : null;
  },
});

export const recordPromptProvision = internalMutation({
  args: {
    organizationId: v.string(),
    promptSlug: v.string(),
    promptId: v.id('promptTemplates'),
    contentHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('promptDefaultProvisions')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('promptSlug', args.promptSlug),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        promptId: args.promptId,
        contentHash: args.contentHash,
        provisionedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.insert('promptDefaultProvisions', {
      organizationId: args.organizationId,
      promptSlug: args.promptSlug,
      promptId: args.promptId,
      contentHash: args.contentHash,
      provisionedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Insert one seeded prompt as a `global`-scope row owned by `system`. Trusts
 * the caller (the provisioner) to have checked the provision ledger first;
 * normalization + size guards still run so a malformed catalog file fails
 * loudly rather than persisting a bad row. Returns the new prompt id (or null
 * if the catalog entry was empty after normalization).
 */
export const provisionDefaultPrompt = internalMutation({
  args: {
    organizationId: v.string(),
    title: v.string(),
    content: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.union(v.id('promptTemplates'), v.null()),
  handler: async (ctx, args) => {
    const normalized = normalizePromptFields({
      title: args.title,
      content: args.content,
      description: args.description,
      category: args.category,
      tags: args.tags,
    });
    assertPromptSizes(normalized);

    const content = normalized.content ?? '';
    if (content.trim() === '') return null;

    const title =
      normalized.title && normalized.title.length > 0
        ? normalized.title
        : 'Untitled prompt';
    const now = Date.now();

    const scope = 'global' as const;
    const metadata = {
      title,
      description: normalized.description,
      // Seeded prompts carry only the legacy `category` string; the existing
      // lazy-migration path stamps a `promptCategories` id on first edit.
      category: normalized.category,
      tags: normalized.tags,
      scope,
    };

    const id = await ctx.db.insert('promptTemplates', {
      organizationId: args.organizationId,
      createdBy: 'system',
      title,
      content,
      description: normalized.description,
      scope,
      category: normalized.category,
      tags: normalized.tags,
      usageCount: 0,
      lifecycleStatus: 'active',
      version: 1,
      versionHistory: [
        buildInitialVersionEntry({
          content,
          publishedBy: 'system',
          publishedAt: now,
          metadata,
        }),
      ],
    });
    return id;
  },
});
