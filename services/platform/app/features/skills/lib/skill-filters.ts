/**
 * The library's scope predicate and label accessor — the two skill-specific
 * pieces the shared `useCatalogFacets` pipeline needs. Everything generic about
 * narrowing (facet collection, AND semantics, search) lives in that hook, so all
 * three catalogs behave identically.
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

/** The facet values a skill carries. */
export function labelsOf(skill: ScopedSkill): readonly string[] {
  return skill.labels ?? [];
}
