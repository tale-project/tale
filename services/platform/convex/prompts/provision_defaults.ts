'use node';

/**
 * Default-prompt provisioner: seeds the `metadata.autoInstall` prompt files
 * shipped in the catalog as `global`-scope rows in an organization's prompt
 * library. A prompt file on disk is inert — it needs a `promptTemplates` row.
 * This action walks the org's prompts dir, and for every autoInstall file not
 * yet provisioned (tracked in `promptDefaultProvisions`):
 *
 *   1. inserts a global prompt row (createdBy 'system'),
 *   2. records the provision so the org is never re-seeded behind its back
 *      (edits/deletes stick).
 *
 * Invoked from the org-creation hook (after the scaffold copies the catalog)
 * and from the ops migration for existing orgs. Self-retries while the prompts
 * dir does not exist yet (scaffold still running). Mirrors
 * `workflows/provision_defaults.ts`.
 */

import { v } from 'convex/values';

import { resolvePromptDisplay } from '../../lib/shared/schemas/prompts';
import { clampToSupportedLocale } from '../../lib/shared/utils/get-organization-default-locale';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { listCatalogArea } from '../lib/config_store/catalog';
import {
  parsePromptJson,
  promptSlugFromFileName,
  sha256,
  validatePromptSlug,
} from './file_utils';

const RETRY_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 3;

export const syncDefaultPromptInstallations = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    /**
     * The org's chosen language (one of the supported app locales). Seeded
     * prompts use the matching localized copy, falling back to English
     * per-field. When omitted, resolved from the org's `defaultLocale`
     * metadata (the ops-migration path).
     */
    locale: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  returns: v.object({
    provisioned: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ provisioned: number; skipped: number; failed: number }> => {
    const attempt = args.attempt ?? 1;

    // Resolve the org's language: explicit arg wins (org-creation hook passes
    // the wizard choice), else read the org's `defaultLocale` metadata.
    const locale = args.locale
      ? clampToSupportedLocale(args.locale)
      : await ctx.runQuery(
          internal.organizations.internal_queries.getOrganizationDefaultLocale,
          { organizationId: args.organizationId },
        );

    let files;
    try {
      files = await listCatalogArea('prompts', args.orgSlug);
    } catch {
      // Scaffold may still be copying the catalog — retry a bounded number
      // of times, then give up quietly (the ops migration can re-run).
      if (attempt < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS,
          internal.prompts.provision_defaults.syncDefaultPromptInstallations,
          { ...args, attempt: attempt + 1 },
        );
      } else {
        console.warn(
          '[PromptProvision] prompts dir missing after retries; giving up',
          { orgSlug: args.orgSlug },
        );
      }
      return { provisioned: 0, skipped: 0, failed: 0 };
    }

    let provisioned = 0;
    let skipped = 0;
    let failed = 0;

    for (const { relativePath, content } of files) {
      const promptSlug = promptSlugFromFileName(relativePath);
      if (!validatePromptSlug(promptSlug)) continue;

      try {
        const prompt = parsePromptJson(content);
        if (prompt.metadata?.autoInstall !== true) continue;

        const existing = await ctx.runQuery(
          internal.prompts.provision_defaults_mutations.getPromptProvision,
          { organizationId: args.organizationId, promptSlug },
        );
        if (existing) {
          // Already provisioned once — never re-seed behind the org's back.
          skipped += 1;
          continue;
        }

        const contentHash = sha256(content);
        const display = resolvePromptDisplay(prompt, locale);
        const promptId = await ctx.runMutation(
          internal.prompts.provision_defaults_mutations.provisionDefaultPrompt,
          {
            organizationId: args.organizationId,
            title: display.title,
            content: display.content,
            description: display.description,
            category: display.category,
            // Tags stay locale-agnostic (filterable keys, not display copy).
            tags: prompt.tags,
          },
        );
        if (!promptId) {
          // Empty after normalization — skip without recording so a fixed
          // catalog file can provision on the next run.
          failed += 1;
          continue;
        }

        await ctx.runMutation(
          internal.prompts.provision_defaults_mutations.recordPromptProvision,
          {
            organizationId: args.organizationId,
            promptSlug,
            promptId,
            contentHash,
          },
        );
        provisioned += 1;
        console.log('[PromptProvision] provisioned', {
          org: args.organizationId,
          promptSlug,
        });
      } catch (error) {
        failed += 1;
        console.error('[PromptProvision] failed for prompt', {
          promptSlug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { provisioned, skipped, failed };
  },
});
