/**
 * Migration: Backfill files/entryFile on legacy single-content artifacts.
 *
 * Phase A of the multi-file refactor: rows created before this deploy have
 * `content: string` but no `files` / `entryFile`. Synthesize them in place:
 *
 *   files: [{ path: defaultEntryFileFor(type, language), content }]
 *   entryFile: defaultEntryFileFor(type, language)
 *
 * Idempotent — skips rows already carrying `files`.
 *
 * Live-streaming rows are NOT skipped. Backfill writes synthesized values
 * with the current `content`; subsequent settle under new code will overwrite
 * with the canonical post-edit state.
 */

import { internalMutation } from '../_generated/server';
import { defaultEntryFileFor } from '../agent_tools/artifacts/shared';

const BATCH_SIZE = 50;

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    let totalUpdated = 0;
    let totalSkipped = 0;
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      let updated = 0;
      let skipped = 0;

      const result = await ctx.db
        .query('artifacts')
        .paginate({ cursor, numItems: BATCH_SIZE });

      for (const row of result.page) {
        if (row.files !== undefined && row.entryFile !== undefined) {
          skipped++;
          continue;
        }
        const entryFile = defaultEntryFileFor(row.type, row.language);
        const content = row.content ?? '';
        const files = [{ path: entryFile, content }];
        try {
          await ctx.db.patch(row._id, {
            files,
            entryFile,
            // Leave `content` in place for rollback safety (Phase A).
          });
          updated++;
        } catch (err) {
          console.error(
            `[backfill_artifact_files] Error processing artifact ${String(row._id)}:`,
            err,
          );
          skipped++;
        }
      }

      console.log(
        `[backfill_artifact_files] Batch: updated=${updated}, skipped=${skipped}, done=${result.isDone}`,
      );

      totalUpdated += updated;
      totalSkipped += skipped;
      cursor = result.continueCursor;
      isDone = result.isDone;
    }

    return { updated: totalUpdated, skipped: totalSkipped };
  },
});
