'use node';

/**
 * Workflow JSON file utilities.
 *
 * Pure helpers for resolving paths, validating slugs, and parsing workflow JSON.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import { statSync } from 'node:fs';
import path from 'node:path';

import { isValidAppSlug } from '../../lib/shared/schemas/apps';
import {
  workflowJsonSchema,
  type WorkflowJsonConfig,
} from '../../lib/shared/schemas/workflows';
import { canonicalizeWorkflowConfig } from '../../lib/shared/utils/canonicalize-config';
import { resolveAppDir } from '../apps/file_utils';
import {
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';

export { sha256 };

/**
 * Workflow slug: nestable folders (`folder/subfolder/name`), lowercase
 * alphanumeric + hyphens/underscores per segment. Consecutive underscores (__)
 * are reserved as the URL separator and not allowed inside a segment.
 * Examples: "my_workflow", "github/sync-issues-from-github",
 * "projects/tasks/run-assigned-task".
 */
const WORKFLOW_SLUG_REGEX =
  /^(?!.*__)[a-z0-9][a-z0-9_-]*(\/(?!.*__)[a-z0-9][a-z0-9_-]*)*$/;

const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB
const MAX_HISTORY_ENTRIES = 100;

/** Separator used in URLs and flattened history paths to represent `/` in slugs. */
const SLUG_SEPARATOR = '__';

export type WorkflowReadResult =
  | { ok: true; config: WorkflowJsonConfig; hash: string }
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

/**
 * Extract workflow slug from a relative file path.
 * "general/conversation-sync.json" → "general/conversation-sync"
 * "my-workflow.json" → "my-workflow"
 */
export function workflowSlugFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.json$/, '').replace(/\\/g, '/');
}

/**
 * Convert a filesystem slug (with /) to a URL-safe parameter (with --).
 * "general/conversation-sync" → "general--conversation-sync"
 */
export function slugToUrlParam(slug: string): string {
  return slug.replace(/\//g, SLUG_SEPARATOR);
}

/**
 * Convert a URL parameter (with --) back to a filesystem slug (with /).
 * "general--conversation-sync" → "general/conversation-sync"
 */
export function urlParamToSlug(param: string): string {
  return param.replace(new RegExp(SLUG_SEPARATOR, 'g'), '/');
}

/**
 * Resolve the workflows directory for an organization. Org-first:
 * `${TALE_CONFIG_DIR}/<orgSlug>/workflows/`. No `@`-prefix collision concern
 * here since workflow folders live inside the per-org subtree.
 */
export function resolveWorkflowsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('workflows'), orgSlug, 'workflows');
}

/**
 * App-owned workflows live under the app's OWN bundle dir
 * (`org/apps/<app>/workflows/`), keeping them out of the global automations
 * surfaces by construction.
 */
export function resolveAppWorkflowsDir(
  orgSlug: string,
  appSlug: string,
): string {
  return path.join(resolveAppDir(orgSlug, appSlug), 'workflows');
}

/**
 * Decide whether a workflow slug `a/b` is APP-owned: iff `a` is a valid app slug
 * AND that app has a workflows dir on disk. The `/` is OVERLOADED here (global
 * folders like `general/…` vs an app prefix), so — unlike agents, where `/`
 * unambiguously means app — this needs an existence check. Done SYNCHRONOUSLY so
 * the path builders stay sync and every existing call site is untouched. The
 * install guard forbids an app slug from shadowing a global workflow folder, so
 * the first segment is decisive.
 */
function workflowAppOwner(
  orgSlug: string,
  workflowSlug: string,
): string | undefined {
  const slash = workflowSlug.indexOf('/');
  if (slash === -1) return undefined;
  const seg = workflowSlug.slice(0, slash);
  if (!isValidAppSlug(seg)) return undefined;
  try {
    return statSync(resolveAppWorkflowsDir(orgSlug, seg)).isDirectory()
      ? seg
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the absolute file path for a workflow JSON file. Validates the slug
 * and checks for path traversal. App-owned slugs resolve under the app's bundle
 * (`org/apps/<app>/workflows/`); global slugs under `org/workflows/`.
 */
export function resolveWorkflowFilePath(
  orgSlug: string,
  workflowSlug: string,
): string {
  if (!validateWorkflowSlug(workflowSlug)) {
    throw new Error(`Invalid workflow slug: ${workflowSlug}`);
  }
  const appSlug = workflowAppOwner(orgSlug, workflowSlug);
  const baseDir = appSlug
    ? resolveAppWorkflowsDir(orgSlug, appSlug)
    : resolveWorkflowsDir(orgSlug);
  return safeJoinWithinDir(baseDir, `${workflowSlug}.json`);
}

/**
 * Resolve the history directory for a workflow.
 * Uses flattened slug (-- instead of /) to avoid nested history dirs.
 */
export function resolveHistoryDir(
  orgSlug: string,
  workflowSlug: string,
): string {
  const flatSlug = slugToUrlParam(workflowSlug);
  const appSlug = workflowAppOwner(orgSlug, workflowSlug);
  const baseDir = appSlug
    ? resolveAppWorkflowsDir(orgSlug, appSlug)
    : resolveWorkflowsDir(orgSlug);
  return path.join(baseDir, '.history', flatSlug);
}

export function serializeWorkflowJson(config: WorkflowJsonConfig): string {
  return serializeJson(canonicalizeWorkflowConfig(config));
}

export function parseWorkflowJson(content: string): WorkflowJsonConfig {
  const parsed: unknown = JSON.parse(content);
  const result = workflowJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid workflow JSON: ${result.error.message}`);
  }
  return result.data;
}

export { MAX_FILE_SIZE_BYTES, MAX_HISTORY_ENTRIES };
