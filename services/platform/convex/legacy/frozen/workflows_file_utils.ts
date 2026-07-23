'use node';

/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Trimmed copy of `file_utils.ts` from the retired `convex/workflows/`
 * domain. That
 * original file already carried a "LEGACY-CHAIN ONLY" banner marking
 * `resolveWorkflowsDir` / `resolveWorkflowFilePath` (+ their
 * `validateWorkflowSlug` / `workflowSlugFromRelativePath` helpers) as kept
 * SOLELY for `v0_3_4/06_remove_retired_task_workflows/migration.ts`,
 * `v0_3_4/30_run_assigned_task_admission_gate/migration.ts`, and
 * `v0_3_4/35_remove_standalone_workflow_files/migration.ts` — this frozen
 * module trims to exactly the two of those the migrations import
 * (`resolveWorkflowsDir`, `resolveWorkflowFilePath`); `workflowSlugFromRelativePath`
 * is unused by any migration and is dropped.
 *
 * NOT frozen: `parseWorkflowJson` / `serializeWorkflowJson` /
 * `WorkflowReadResult` / `validateWorkflowSlug`'s size-cap sibling
 * `MAX_FILE_SIZE_BYTES` / `MAX_HISTORY_ENTRIES` — no migration parses or
 * serializes a workflow JSON body; they only resolve its PATH. Because of
 * that, this module needs NO schema dependency at all (unlike
 * `agents_file_utils.ts`/`providers_file_utils.ts`) — `getConfigRoot` /
 * `safeJoinWithinDir` / `validateOrgSlug` (`convex/lib/file_io.ts`) are STILL
 * LIVE and imported directly, unchanged.
 */

import path from 'node:path';

import {
  getConfigRoot,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../../lib/file_io';

/**
 * Workflow slug shape. Live slugs are flat automation slugs (an inline
 * workflow's slug IS its automation's slug), but the validator still accepts
 * the historical foldered form (`folder/name`, e.g.
 * "projects/tasks/run-assigned-task") so requests carrying a pre-cutover slug
 * degrade to a clean not-found instead of an invalid-input throw. Lowercase
 * alphanumeric + hyphens/underscores per segment; consecutive underscores
 * (`__`) were the historical URL separator and stay reserved.
 */
const WORKFLOW_SLUG_REGEX =
  /^(?!.*__)[a-z0-9][a-z0-9_-]*(\/(?!.*__)[a-z0-9][a-z0-9_-]*)*$/;

function validateWorkflowSlug(slug: string): boolean {
  return WORKFLOW_SLUG_REGEX.test(slug) && slug.length <= 128;
}

/**
 * LEGACY-CHAIN ONLY: standalone workflow files no longer exist post-v0.3.4;
 * this resolver is kept solely for the pre-cutover migrations. Never call
 * from live code.
 */
export function resolveWorkflowsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('workflows'), orgSlug, 'workflows');
}

/**
 * LEGACY-CHAIN ONLY (see banner). The absolute file path a standalone
 * workflow JSON lived at under `org/workflows/`. Validates the slug and
 * checks for path traversal.
 */
export function resolveWorkflowFilePath(
  orgSlug: string,
  workflowSlug: string,
): string {
  if (!validateWorkflowSlug(workflowSlug)) {
    throw new Error(`Invalid workflow slug: ${workflowSlug}`);
  }
  return safeJoinWithinDir(
    resolveWorkflowsDir(orgSlug),
    `${workflowSlug}.json`,
  );
}
