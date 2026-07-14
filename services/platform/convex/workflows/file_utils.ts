'use node';

/**
 * Workflow JSON utilities.
 *
 * Pure helpers for validating workflow slugs and parsing/serializing workflow
 * JSON. A workflow exists ONLY inline in an automation manifest
 * (`automations/<slug>/automation.json` `workflow` — see
 * `definition_store.ts`); a workflowSlug IS an automation slug, so there is no
 * live on-disk workflow file to resolve. The path resolvers at the bottom are
 * kept solely for the pre-cutover migrations (see the LEGACY banner).
 * No Convex dependencies — these can be used in any Node.js context.
 */

import path from 'node:path';

import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import {
  workflowJsonSchema,
  type WorkflowJsonConfig,
} from '../../lib/shared/schemas/workflows';
import { canonicalizeWorkflowConfig } from '../../lib/shared/utils/canonicalize-config';
import {
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  validateOrgSlug,
} from '../lib/file_io';
import type { SpecSyncStatus } from './specification_fingerprint';

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

const MAX_HISTORY_ENTRIES = 100;

export type WorkflowReadResult =
  | {
      ok: true;
      config: WorkflowJsonConfig;
      hash: string;
      specSyncStatus: SpecSyncStatus;
    }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'corrupted'
        | 'too_large'
        | 'symlink'
        | 'inaccessible';
      message: string;
    };

export function validateWorkflowSlug(slug: string): boolean {
  return WORKFLOW_SLUG_REGEX.test(slug) && slug.length <= 128;
}

export function serializeWorkflowJson(config: WorkflowJsonConfig): string {
  return serializeJson(canonicalizeWorkflowConfig(config));
}

export function parseWorkflowJson(content: string): WorkflowJsonConfig {
  const parsed: unknown = JSON.parse(content);
  const result = workflowJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(zodErrorMessage('Invalid workflow JSON', result.error));
  }
  return result.data;
}

export { MAX_HISTORY_ENTRIES };

// ---------------------------------------------------------------------------
// LEGACY-CHAIN ONLY: standalone workflow files no longer exist post-v0.3.4;
// everything below is kept solely for the pre-cutover migrations
// (v0_3_4/06_remove_retired_task_workflows, v0_3_4/30_run_assigned_task_
// admission_gate and their world testkits), which operate on org trees that
// STILL HAVE a `workflows/` dir mid-upgrade. Never call from live code.
// ---------------------------------------------------------------------------

/** LEGACY-CHAIN ONLY (see banner): size cap for standalone workflow files. */
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB
export { MAX_FILE_SIZE_BYTES };

/**
 * LEGACY-CHAIN ONLY (see banner). Extract a workflow slug from a relative
 * file path: "general/conversation-sync.json" → "general/conversation-sync".
 */
export function workflowSlugFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.json$/, '').replace(/\\/g, '/');
}

/**
 * LEGACY-CHAIN ONLY (see banner). The retired standalone-workflows dir of an
 * organization: `${TALE_CONFIG_DIR}/<orgSlug>/workflows/`.
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
