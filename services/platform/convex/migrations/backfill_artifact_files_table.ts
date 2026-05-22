/**
 * Migration: Backfill `artifactFiles` / `artifactRuns` / `artifactRunFiles`
 * dedicated tables from the legacy embedded `artifacts.files[]` and
 * `artifacts.runOutputFiles[]` fields.
 *
 * Part of the refactor described in plan llm-majestic-hamming.md. The
 * legacy fields stay on `artifactsTable` as `@deprecated` (per
 * [feedback_deprecate_dont_delete_schema_fields]) — this script only
 * POPULATES the new tables; nothing is deleted from `artifacts`.
 *
 * Idempotent — each step checks for an existing target row via the
 * appropriate index before inserting. Safe to re-run, safe to interrupt.
 *
 *   files     → `artifactFiles` (one row per (artifactId, path))
 *   run state → `artifactRuns` + `artifactRunFiles` IF status is terminal
 *               (completed / failed / cancelled). In-flight statuses
 *               aren't synthesized — they weren't durable history anyway.
 *
 * Live-streaming rows: backfilled with the current `files[]` snapshot;
 * subsequent settle under new code will upsert via the regular write path.
 *
 * Manual invocation:
 *   `npx convex run migrations/backfill_artifact_files_table:apply`
 */

import { internalMutation } from '../_generated/server';

const BATCH_SIZE = 50;

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    let totalArtifacts = 0;
    let totalFilesCreated = 0;
    let totalRunsCreated = 0;
    let totalRunFilesCreated = 0;
    let totalSkipped = 0;
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      const result = await ctx.db
        .query('artifacts')
        .paginate({ cursor, numItems: BATCH_SIZE });

      for (const row of result.page) {
        totalArtifacts += 1;
        const now = Date.now();

        // 1. Backfill artifactFiles from legacy artifacts.files[].
        const legacyFiles = row.files ?? [];
        for (const f of legacyFiles) {
          const existing = await ctx.db
            .query('artifactFiles')
            .withIndex('by_artifact_path', (q) =>
              q.eq('artifactId', row._id).eq('path', f.path),
            )
            .first();
          if (existing !== null) {
            totalSkipped += 1;
            continue;
          }
          try {
            await ctx.db.insert('artifactFiles', {
              artifactId: row._id,
              path: f.path,
              content: f.content,
              createdAt: now,
              updatedAt: now,
            });
            totalFilesCreated += 1;
          } catch (err) {
            console.error(
              `[backfill_artifact_files_table] Error inserting artifactFiles for ${String(row._id)} / ${f.path}:`,
              err,
            );
          }
        }

        // 2. Backfill artifactRuns + artifactRunFiles from terminal
        //    run state. In-flight statuses (queued/installing/running)
        //    aren't synthesized — they have no durable meaning post-refactor.
        const runStatus = row.runStatus;
        const isTerminal =
          runStatus === 'completed' ||
          runStatus === 'failed' ||
          runStatus === 'cancelled';
        if (!isTerminal) continue;

        const existingRun = await ctx.db
          .query('artifactRuns')
          .withIndex('by_artifact', (q) => q.eq('artifactId', row._id))
          .first();
        if (existingRun !== null) {
          totalSkipped += 1;
          continue;
        }

        try {
          const startedAt = row.runStartedAt ?? now;
          const runId = await ctx.db.insert('artifactRuns', {
            artifactId: row._id,
            status: runStatus,
            ...(row.runExitCode !== undefined && {
              exitCode: row.runExitCode,
            }),
            ...(row.runErrorCode !== undefined && {
              errorCode: row.runErrorCode,
            }),
            ...(row.runErrorMessage !== undefined && {
              errorMessage: row.runErrorMessage,
            }),
            startedAt,
            ...(row.runCompletedAt !== undefined && {
              endedAt: row.runCompletedAt,
            }),
            revision: row.runRevision ?? row.revision,
            ...(row.runExecutionId !== undefined && {
              executionId: row.runExecutionId,
            }),
          });
          totalRunsCreated += 1;

          for (const out of row.runOutputFiles ?? []) {
            if (out.storageId === undefined) continue;
            await ctx.db.insert('artifactRunFiles', {
              runId,
              artifactId: row._id,
              name: out.name,
              storageId: out.storageId,
              size: out.size,
              ...(out.contentType !== undefined && {
                contentType: out.contentType,
              }),
              createdAt: now,
            });
            totalRunFilesCreated += 1;
          }
        } catch (err) {
          console.error(
            `[backfill_artifact_files_table] Error synthesizing artifactRuns for ${String(row._id)}:`,
            err,
          );
        }
      }

      console.log(
        `[backfill_artifact_files_table] Batch: artifacts=${result.page.length}, filesCreated=${totalFilesCreated}, runsCreated=${totalRunsCreated}, runFilesCreated=${totalRunFilesCreated}, done=${result.isDone}`,
      );

      cursor = result.continueCursor;
      isDone = result.isDone;
    }

    return {
      artifacts: totalArtifacts,
      filesCreated: totalFilesCreated,
      runsCreated: totalRunsCreated,
      runFilesCreated: totalRunFilesCreated,
      skipped: totalSkipped,
    };
  },
});
