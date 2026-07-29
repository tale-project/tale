import { describe, expect, it } from 'vitest';

import { labelsOf, matchesScopeTab, SKILL_SCOPE_TABS } from './skill-filters';

const org = { visibility: 'org' } as const;
const team = { visibility: 'team' } as const;
const personal = { visibility: 'private' } as const;

describe('matchesScopeTab', () => {
  it('lets everything through on the all tab', () => {
    for (const skill of [org, team, personal]) {
      expect(matchesScopeTab(skill, 'all')).toBe(true);
    }
  });

  it('maps each scope tab onto exactly one visibility', () => {
    expect([org, team, personal].map((s) => matchesScopeTab(s, 'org'))).toEqual(
      [true, false, false],
    );
    expect(
      [org, team, personal].map((s) => matchesScopeTab(s, 'team')),
    ).toEqual([false, true, false]);
    // "personal" is the reader-facing name for the `private` visibility.
    expect(
      [org, team, personal].map((s) => matchesScopeTab(s, 'personal')),
    ).toEqual([false, false, true]);
  });

  it('partitions any skill into exactly one non-all tab', () => {
    for (const skill of [org, team, personal]) {
      const matched = SKILL_SCOPE_TABS.filter(
        (tab) => tab !== 'all' && matchesScopeTab(skill, tab),
      );
      expect(matched).toHaveLength(1);
    }
  });
});

describe('labelsOf', () => {
  it('returns the labels a skill carries', () => {
    expect(labelsOf({ ...org, labels: ['research', 'writing'] })).toEqual([
      'research',
      'writing',
    ]);
  });

  it('treats a skill with no labels as carrying none', () => {
    // The shared facet pipeline reads this directly; `undefined` would throw.
    expect(labelsOf(org)).toEqual([]);
  });
});
