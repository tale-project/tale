'use node';

/**
 * Prompt-library JSON file utilities.
 *
 * Pure helpers for resolving the per-org default-prompt catalog directory,
 * validating slugs, and parsing prompt JSON. No Convex dependencies — usable
 * in any Node.js context (mirrors workflows/file_utils.ts).
 *
 * The default prompt catalog ships at `examples/default/prompts/*.json` and is
 * copied per-org by the scaffold (`organizations/scaffold.ts`, `prompts` is a
 * `flat` domain) into `${TALE_CONFIG_DIR}/<orgSlug>/prompts/`. The provisioner
 * (`provision_defaults.ts`) then seeds each `autoInstall` file as a global
 * prompt row.
 */

import path from 'node:path';

import {
  promptJsonSchema,
  type PromptJsonConfig,
} from '../../lib/shared/schemas/prompts';
import { getConfigRoot, sha256, validateOrgSlug } from '../lib/file_io';

/**
 * Prompt slug: lowercase alphanumeric + hyphens/underscores, no nesting.
 * Examples: "summarize-text", "weigh-pros-and-cons".
 */
const PROMPT_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export function validatePromptSlug(slug: string): boolean {
  return PROMPT_SLUG_REGEX.test(slug) && slug.length <= 128;
}

/**
 * Extract a prompt slug from a relative file path.
 * "summarize-text.json" → "summarize-text"
 */
export function promptSlugFromFileName(fileName: string): string {
  return fileName.replace(/\.json$/, '');
}

/**
 * Resolve the prompts directory for an organization. Org-first:
 * `${TALE_CONFIG_DIR}/<orgSlug>/prompts/`.
 */
export function resolvePromptsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('prompts'), orgSlug, 'prompts');
}

export function parsePromptJson(content: string): PromptJsonConfig {
  const parsed: unknown = JSON.parse(content);
  const result = promptJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid prompt JSON: ${result.error.message}`);
  }
  return result.data;
}

export { sha256 };
