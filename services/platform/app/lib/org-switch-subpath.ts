/**
 * Sanitize the subpath the org switcher carries into the target org.
 *
 * Switching orgs preserves the current page's subpath so you keep your tab /
 * filter / hash (see `routes/dashboard/switching.tsx`). But a subpath that
 * points at an org-scoped ENTITY detail — a project or a chat thread — must
 * NOT be carried verbatim: that entity does not exist in the target org,
 * so the read correctly denies it and the user dead-ends on "We couldn't find
 * that project". For those sections we reset to the section root (the
 * list/home, which exists in every org).
 *
 * Status/filter and config subpaths are org-agnostic and preserved in full
 * (query string + hash included): `settings/*`, `agents/{slug}` (slug-keyed
 * config, not a Convex id), `_knowledge`.
 *
 * This is "layer 1" of the org-switch active-org-coherence fix, paired with the
 * backend by-id active-org guard (`isActiveOrg`) that does the actual denying.
 */

/** Top-level sections whose detail route is keyed by an org-scoped entity
 *  (`projects/$projectId`, `chat/$threadId`). Automations are addressed by
 *  slug, which every organization's own catalog can carry, so they are
 *  preserved like `agents/{slug}`. */
const ENTITY_DETAIL_SECTIONS = new Set(['projects', 'chat']);

/**
 * `projects/abc123/tasks` → `projects`; `chat/t_1#mid` → `chat`. Section roots,
 * filters, and config subpaths pass through untouched: `projects?archived=true`,
 * `settings/governance?group=security`.
 */
export function resetCrossOrgDetailSubpath(subpath: string): string {
  // The section is the first path segment, before any '/', '?' or '#'.
  const section = subpath.split(/[/?#]/, 1)[0];
  if (!ENTITY_DETAIL_SECTIONS.has(section)) return subpath;
  // A detail id is present iff a '/' immediately follows the section
  // (`projects/abc`). `projects` and `projects?filter=x` have none — keep them.
  const rest = subpath.slice(section.length);
  if (!rest.startsWith('/')) return subpath;
  return section;
}
