import { describe, expect, it } from 'vitest';

import {
  RETENTION_CATEGORIES,
  type AppliedBoundsByCategory,
} from '../../../lib/shared/schemas/retention';
import { buildImpactPreview, diffBounds } from './retention_bounds_proposal';
import {
  RETENTION_POLICY_FIELD_BY_CATEGORY,
  clampConfigToBounds,
  type EffectiveBoundDef,
} from './retention_floors';

describe('diffBounds', () => {
  it('returns an empty diff for identical snapshots', () => {
    const bounds = { documents: { min: 7, max: 365 } };
    expect(diffBounds(bounds, bounds)).toEqual([]);
  });

  it('reports raised floors and lowered ceilings as tighten', () => {
    expect(
      diffBounds(
        { documents: { min: 7, max: 365 } },
        { documents: { min: 30, max: 180 } },
      ),
    ).toEqual([
      {
        category: 'documents',
        field: 'min',
        from: 7,
        to: 30,
        direction: 'tighten',
      },
      {
        category: 'documents',
        field: 'max',
        from: 365,
        to: 180,
        direction: 'tighten',
      },
    ]);
  });

  it('reports lowered floors and raised ceilings as loosen', () => {
    expect(
      diffBounds(
        { documents: { min: 30, max: 180 } },
        { documents: { min: 7, max: 365 } },
      ),
    ).toEqual([
      {
        category: 'documents',
        field: 'min',
        from: 30,
        to: 7,
        direction: 'loosen',
      },
      {
        category: 'documents',
        field: 'max',
        from: 180,
        to: 365,
        direction: 'loosen',
      },
    ]);
  });

  // Regression: a category present only in the proposal (e.g. a release
  // ships a new retention category the org's applied snapshot predates)
  // changed the hash but produced NO diff entries, so the banner rendered
  // as "0 of 0 change(s) tighten retention" with nothing to review.
  it('reports a newly bounded category as tighten with a null from', () => {
    expect(
      diffBounds(
        { documents: { min: 7, max: 365 } },
        {
          documents: { min: 7, max: 365 },
          notifications: { min: 1, max: 90 },
        },
      ),
    ).toEqual([
      {
        category: 'notifications',
        field: 'min',
        from: null,
        to: 1,
        direction: 'tighten',
      },
      {
        category: 'notifications',
        field: 'max',
        from: null,
        to: 90,
        direction: 'tighten',
      },
    ]);
  });

  it('reports a no-longer-bounded category as loosen with a null to', () => {
    expect(
      diffBounds(
        {
          documents: { min: 7, max: 365 },
          notifications: { min: 1, max: 90 },
        },
        { documents: { min: 7, max: 365 } },
      ),
    ).toEqual([
      {
        category: 'notifications',
        field: 'min',
        from: 1,
        to: null,
        direction: 'loosen',
      },
      {
        category: 'notifications',
        field: 'max',
        from: 90,
        to: null,
        direction: 'loosen',
      },
    ]);
  });

  it('treats every category of a first apply (null snapshot) as newly bounded', () => {
    const diff = diffBounds(null, { documents: { min: 7, max: 365 } });
    expect(diff).toHaveLength(2);
    expect(diff.every((d) => d.from === null)).toBe(true);
    expect(diff.every((d) => d.direction === 'tighten')).toBe(true);
  });
});

describe('buildImpactPreview ↔ clampConfigToBounds parity', () => {
  it('promises exactly the clamp the sweep performs, for every category', () => {
    // Every category bounded to [10, 20]; the stored policy sits below the
    // floor on half of them and above the ceiling on the other half.
    const proposed: AppliedBoundsByCategory = {};
    const bounds: Partial<Record<string, EffectiveBoundDef>> = {};
    const stored: Record<string, number> = {};
    RETENTION_CATEGORIES.forEach((category, index) => {
      proposed[category] = { min: 10, max: 20 };
      bounds[category] = {
        category,
        min: 10,
        max: 20,
        default: 15,
        unit: category.endsWith('Hours') ? 'hours' : 'days',
        source: 'file',
        minEnv: { envName: '', source: 'none', applied: false },
        maxEnv: { envName: '', source: 'none', applied: false },
        defaultEnv: { envName: '', source: 'none', applied: false },
      };
      stored[RETENTION_POLICY_FIELD_BY_CATEGORY[category]] =
        index % 2 === 0 ? 1 : 99;
    });
    const preview = buildImpactPreview(proposed, stored);
    const clamped = clampConfigToBounds(bounds, stored);
    expect(preview).toHaveLength(RETENTION_CATEGORIES.length);
    for (const entry of preview) {
      expect(clamped[entry.field]).toBe(entry.willClampTo);
      expect(clamped[entry.field]).not.toBe(entry.current);
    }
    // The category whose preview used to lie: clamp and preview agree.
    expect(clamped.agentRunsRetentionDays).toBe(
      preview.find((entry) => entry.category === 'agentRuns')?.willClampTo,
    );
  });
});
