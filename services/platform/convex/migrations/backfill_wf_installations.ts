'use node';

/**
 * Migration: Backfill wfInstallations from legacy JSON `installed` field.
 *
 * The workflow JSON file used to carry `installed: boolean` and `enabled`.
 * Both are now removed from the schema; "installed" lives in the
 * `wfInstallations` table.
 *
 * For each workflow JSON file with `installed: true` (legacy), this migration
 * upserts a `wfInstallations` row and then re-writes the file without the
 * legacy fields. Re-runnable.
 *
 * Usage:
 *   bunx convex run migrations/backfill_wf_installations:backfillWfInstallations '{ "orgSlug": "default", "organizationId": "org-id" }'
 */

import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  sha256,
} from '../lib/file_io';
import {
  MAX_HISTORY_ENTRIES,
  resolveHistoryDir,
  resolveWorkflowFilePath,
  resolveWorkflowsDir,
  serializeWorkflowJson,
  validateWorkflowSlug,
  workflowSlugFromRelativePath,
} from '../workflows/file_utils';

export const backfillWfInstallations = internalAction({
  args: {
    orgSlug: v.string(),
    organizationId: v.string(),
    installedBy: v.optional(v.string()),
  },
  returns: v.object({
    installed: v.number(),
    skipped: v.number(),
    rewritten: v.number(),
    failed: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    installed: number;
    skipped: number;
    rewritten: number;
    failed: number;
  }> => {
    const installedBy = args.installedBy ?? 'migration';

    const dir = resolveWorkflowsDir(args.orgSlug);
    let raw;
    try {
      raw = await readdir(dir, { recursive: true, withFileTypes: true });
    } catch {
      return { installed: 0, skipped: 0, rewritten: 0, failed: 0 };
    }

    let installed = 0;
    let skipped = 0;
    let rewritten = 0;
    let failed = 0;

    for (const entry of raw) {
      const parentPath = entry.parentPath ?? '';
      if (entry.isDirectory()) continue;
      if (!entry.name.endsWith('.json')) continue;
      if (entry.name.startsWith('.')) continue;
      if (parentPath.includes('.history')) continue;

      const relativePath = path
        .relative(dir, path.join(parentPath, entry.name))
        .replace(/\\/g, '/');
      const slug = workflowSlugFromRelativePath(relativePath);
      if (!validateWorkflowSlug(slug)) continue;

      const filePath = resolveWorkflowFilePath(args.orgSlug, slug);
      const content = await readFileSafe(filePath);
      if (!content) continue;

      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(content);
      } catch (err) {
        console.warn('[backfill_wf_installations] parse failed', slug, err);
        failed++;
        continue;
      }

      if (!parsedRaw || typeof parsedRaw !== 'object') {
        skipped++;
        continue;
      }
      const legacyRecord: Record<string, unknown> = { ...parsedRaw };
      const wasInstalled = legacyRecord.installed === true;
      const hadLegacyFields =
        'installed' in legacyRecord || 'enabled' in legacyRecord;

      if (wasInstalled) {
        await ctx.runMutation(
          internal.workflows.installations.upsertInstallation,
          {
            organizationId: args.organizationId,
            workflowSlug: slug,
            installedBy,
            contentHash: sha256(content),
          },
        );
        installed++;
      } else {
        skipped++;
      }

      if (hadLegacyFields) {
        const validated = workflowJsonSchema.safeParse(parsedRaw);
        if (!validated.success) {
          console.warn(
            '[backfill_wf_installations] cannot revalidate after strip',
            slug,
            validated.error.message,
          );
          failed++;
          continue;
        }
        const cleaned = serializeWorkflowJson(validated.data);
        if (cleaned !== content) {
          const historyDir = resolveHistoryDir(args.orgSlug, slug);
          await mkdir(historyDir, { recursive: true });
          await atomicWrite(
            path.join(historyDir, `${generateHistoryTimestamp()}.json`),
            content,
          );
          await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
          await atomicWrite(filePath, cleaned);
          rewritten++;
        }
      }
    }

    return { installed, skipped, rewritten, failed };
  },
});
