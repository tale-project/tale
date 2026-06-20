/**
 * Agent name + slug validation and slug↔URL helpers.
 *
 * Runtime-agnostic — safe to import from both Node.js and edge runtimes.
 */

/**
 * Canonical agent slug: a flat, file-location-independent identity. Because the
 * slug lives in the config (`slug` field) rather than the path, slugs stay flat
 * (single segment, no `/`) and routes need no URL-encoding. `validateAgentName`
 * and `validateAgentSlug` are the same shape — both names are kept for caller
 * clarity (name = a single segment anywhere, slug = the canonical identity).
 */
const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export function validateAgentName(name: string): boolean {
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
