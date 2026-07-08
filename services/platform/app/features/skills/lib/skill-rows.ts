/**
 * The skill list's row shape + the projection from the raw `listSkills`
 * payload. Shared by the settings catalog cards and the agent-binding table so
 * both render the same rows (including broken-bundle rows) — and so the table
 * config can type its columns without importing a component (no type cycle).
 */
import type { SkillListEntry } from '../hooks/queries';

export interface SkillRow {
  slug: string;
  name: string;
  description: string;
  /** Optional Iconify icon name from frontmatter, rendered on the catalog card. */
  icon?: string;
  /** SHA-256 of SKILL.md at list-time, forwarded to deleteSkill for CAS. */
  hash?: string;
  status?: string;
  message?: string;
}

export function toSkillRows(
  rawSkills: SkillListEntry[] | undefined,
): SkillRow[] {
  if (!Array.isArray(rawSkills)) return [];
  const rows: SkillRow[] = [];
  for (const s of rawSkills) {
    if (!s || typeof s.slug !== 'string') continue;
    // Skills with read errors come back with `status`/`message` and no
    // name. Render them as rows with a warning indicator so admins can
    // find and fix them instead of having broken SKILL.md files vanish
    // silently from the list.
    if ('status' in s) {
      rows.push({
        slug: s.slug,
        name: s.slug,
        description: '',
        status: s.status,
        message: typeof s.message === 'string' ? s.message : undefined,
      });
      continue;
    }
    if (typeof s.name !== 'string' || typeof s.description !== 'string') {
      continue;
    }
    rows.push({
      slug: s.slug,
      name: s.name,
      description: s.description,
      icon: typeof s.icon === 'string' ? s.icon : undefined,
      hash: typeof s.hash === 'string' ? s.hash : undefined,
    });
  }
  return rows;
}
