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
