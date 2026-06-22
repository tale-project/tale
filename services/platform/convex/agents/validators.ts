/**
 * Agent name + slug validation and slug↔URL helpers.
 *
 * Runtime-agnostic — safe to import from both Node.js and edge runtimes.
 */

import { isValidAppSlug } from '../../lib/shared/schemas/apps';

const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

/** A single (flat) agent-name segment — the global namespace alphabet. */
export function validateAgentSegment(name: string): boolean {
  return AGENT_NAME_REGEX.test(name);
}

/** Validate a canonical agent slug (flat). */
export function validateAgentSlug(slug: string): boolean {
  return AGENT_NAME_REGEX.test(slug) && slug.length <= 64;
}

/**
 * Fallback slug for a legacy file that carries no explicit `slug` field — the
 * file basename without extension. Only used when `config.slug` is absent;
 * authored agents always set `slug` so identity survives file moves/renames.
 * "github/pull-request-reviewer.json" → "pull-request-reviewer"
 */
export function agentSlugFromFileName(relativePath: string): string {
  const base =
    relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath;
  return base.replace(/\.json$/, '');
}

/**
 * An agent identity. Either a flat GLOBAL name (`coder`) or an app-owned
 * COMPOSITE `<appSlug>/<name>` (`issue-desk/desk-coordinator`). The composite
 * carries its owning app so the slug stays a globally-unique, self-describing
 * identity; app-owned agents live under the app's bundle, invisible to the
 * global agent surfaces. At most one `/`, each segment validated independently
 * (so `..`/absolute paths can never slip through into a resolved path).
 */
export function validateAgentName(name: string): boolean {
  const slash = name.indexOf('/');
  if (slash === -1) return AGENT_NAME_REGEX.test(name);
  const appSlug = name.slice(0, slash);
  const rest = name.slice(slash + 1);
  return isValidAppSlug(appSlug) && AGENT_NAME_REGEX.test(rest);
}
