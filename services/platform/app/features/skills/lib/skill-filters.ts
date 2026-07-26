/**
 * Pure client-side filtering for the library's list pane: the scope tabs
 * map straight onto `visibility`, and the label facet is derived from the
 * loaded list (the listing is unpaginated).
 */

export type SkillScopeTab = 'all' | 'org' | 'team' | 'personal';

export const SKILL_SCOPE_TABS: readonly SkillScopeTab[] = [
  'all',
  'org',
  'team',
  'personal',
];

interface ScopedSkill {
  readonly visibility: 'private' | 'team' | 'org';
  readonly labels?: readonly string[];
}

/** True when `skill` belongs on `tab`. */
export function matchesScopeTab(
  skill: ScopedSkill,
  tab: SkillScopeTab,
): boolean {
  if (tab === 'all') return true;
  if (tab === 'org') return skill.visibility === 'org';
  if (tab === 'team') return skill.visibility === 'team';
  return skill.visibility === 'private';
}

/** Every label used by at least one skill, deduplicated, sorted. */
export function collectLabelFacets(skills: readonly ScopedSkill[]): string[] {
  const labels = new Set<string>();
  for (const skill of skills) {
    for (const label of skill.labels ?? []) labels.add(label);
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

/** True when `skill` carries every selected label (empty = no narrowing). */
export function matchesLabelFilter(
  skill: ScopedSkill,
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true;
  const own = new Set(skill.labels ?? []);
  return selected.every((label) => own.has(label));
}
