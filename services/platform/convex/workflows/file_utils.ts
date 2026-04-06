'use node';

/**
 * Workflow JSON file utilities.
 *
 * Pure helpers for resolving paths, validating slugs, and parsing workflow JSON.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import path from 'node:path';

import {
  workflowJsonSchema,
  type WorkflowJsonConfig,
} from '../../lib/shared/schemas/workflows';
import { serializeJson, sha256, validateOrgSlug } from '../lib/file_io';

export { sha256 };

/**
 * Workflow slug: max 2 levels deep (folder/name), lowercase alphanumeric + hyphens/underscores.
 * Consecutive underscores (__) are reserved as URL separator and not allowed in slugs.
 * Examples: "conversation-sync", "general/conversation-sync", "my_workflow"
 */
const WORKFLOW_SLUG_REGEX =
  /^(?!.*__)[a-z0-9][a-z0-9_-]*(\/(?!.*__)[a-z0-9][a-z0-9_-]*)?$/;

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
  if (!WORKFLOW_SLUG_REGEX.test(slug)) return false;
  if (slug.length > 128) return false;
  return true;
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

function getBaseDir(): string {
  const dir = process.env.WORKFLOWS_DIR;
  if (dir) return dir;
  const configDir = process.env.TALE_CONFIG_DIR;
  if (configDir) return path.join(configDir, 'workflows');
  throw new Error(
    'Neither TALE_CONFIG_DIR nor WORKFLOWS_DIR environment variable is set. ' +
      'Set TALE_CONFIG_DIR in .env to the root config directory ' +
      '(e.g., TALE_CONFIG_DIR=/path/to/tale/examples).',
  );
}

/**
 * Resolve the workflows directory for an organization.
 * Default org uses the base dir directly.
 * Other orgs use `{baseDir}/@{orgSlug}/` to prevent collision with workflow folders.
 */
export function resolveWorkflowsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  const baseDir = getBaseDir();
  if (orgSlug === 'default') {
    return baseDir;
  }
  return path.join(baseDir, `@${orgSlug}`);
}

/**
 * Resolve the absolute file path for a workflow JSON file.
 * Validates the slug and checks for path traversal.
 */
export function resolveWorkflowFilePath(
  orgSlug: string,
  workflowSlug: string,
): string {
  if (!validateWorkflowSlug(workflowSlug)) {
    throw new Error(`Invalid workflow slug: ${workflowSlug}`);
  }
  const dir = resolveWorkflowsDir(orgSlug);
  const resolved = path.resolve(dir, `${workflowSlug}.json`);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${workflowSlug}`);
  }
  return resolved;
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
  return path.join(resolveWorkflowsDir(orgSlug), '.history', flatSlug);
}

export function serializeWorkflowJson(config: WorkflowJsonConfig): string {
  return serializeJson(config);
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
