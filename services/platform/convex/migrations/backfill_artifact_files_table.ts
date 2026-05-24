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
 * **Atomicity contract**:
 * Each batch is a single Convex mutation (transactional). The per-artifact
 * write block (files + run + runFiles) runs without per-step try/catch so
 * any throw propagates and rolls the whole batch back — partial state is
 * impossible. The `_phaseB_complete` sentinel is patched as the LAST write
 * for each artifact; on retry, artifacts with the sentinel are skipped at
 * O(1), so an aborted batch only re-does the unfinished tail.
 *
 *   files     → `artifactFiles` (one row per (artifactId, path))
 *   run state → `artifactRuns` + `artifactRunFiles` IF status is terminal
 *               (completed / failed / cancelled). In-flight statuses
 *               aren't synthesized — they weren't durable history anyway.
 *
 * Live-streaming rows: backfilled with the current `files[]` snapshot;
 * subsequent settle under new code will upsert via the regular write path.
 *
 * Auto-invoked from `migrations.runAll` after Phase A (which synthesizes
 * `files[]` / `entryFile` for legacy single-`content` rows). Manual
 * invocation also supported:
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

        // Sentinel-based idempotency: skip O(1) if a prior batch already
        // finished this artifact. The sentinel is patched as the LAST write
        // for each artifact below, so its presence means every row
        // (artifactFiles + artifactRuns + artifactRunFiles) is in place.
        if (row._phaseB_complete === true) {
          totalSkipped += 1;
          continue;
        }

        const now = Date.now();

        // 1. Backfill artifactFiles from legacy artifacts.files[]. Each
        //    insert is gated by a by_artifact_path index check so we don't
        //    duplicate rows from a partial prior attempt that crashed
        //    before the sentinel landed. (Convex would roll the whole
        //    batch back, but a previous backfill version skipped the
        //    sentinel and the deployment may already carry residue.)
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
          await ctx.db.insert('artifactFiles', {
            artifactId: row._id,
            path: f.path,
            content: f.content,
            createdAt: now,
            updatedAt: now,
          });
          totalFilesCreated += 1;
        }

        // 2. Backfill artifactRuns + artifactRunFiles from terminal
        //    run state. In-flight statuses (queued/installing/running)
        //    aren't synthesized — they have no durable meaning post-refactor.
        const runStatus = row.runStatus;
        const isTerminal =
          runStatus === 'completed' ||
          runStatus === 'failed' ||
          runStatus === 'cancelled';
        if (isTerminal) {
          // Reused-sentinel safety: a pre-sentinel partial attempt may
          // have left an artifactRuns row without all its artifactRunFiles
          // (the orphan class the sentinel design closes). On retry, if
          // an artifactRuns row already exists we treat it as authoritative
          // for the run header but still re-attempt any artifactRunFiles
          // not present in the by_run index.
          const existingRun = await ctx.db
            .query('artifactRuns')
            .withIndex('by_artifact', (q) => q.eq('artifactId', row._id))
            .first();
          let runId = existingRun?._id;
          if (existingRun === null) {
            const startedAt = row.runStartedAt ?? now;
            runId = await ctx.db.insert('artifactRuns', {
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
          }

          if (runId !== undefined) {
            const finalRunId = runId;
            for (const out of row.runOutputFiles ?? []) {
              if (out.storageId === undefined) continue;
              const existingFile = await ctx.db
                .query('artifactRunFiles')
                .withIndex('by_run', (q) => q.eq('runId', finalRunId))
                .filter((q) => q.eq(q.field('name'), out.name))
                .first();
              if (existingFile !== null) {
                totalSkipped += 1;
                continue;
              }
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
          }
        }

        // 3. LAST write: mark this artifact done. If anything above threw
        //    the batch rolls back and this never lands — retry will re-do
        //    the artifact from scratch (per-row idempotency guards above
        //    keep that safe).
        await ctx.db.patch(row._id, { _phaseB_complete: true });
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
