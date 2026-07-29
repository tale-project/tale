import { describe, expect, it } from 'vitest';

import { planSkillStaging } from './staging';

interface Stageable {
  slug: string;
}

const slugOf = (skill: Stageable): string => skill.slug;

describe('planSkillStaging', () => {
  it('withholds the Tale copy when the repository ships the same skill', () => {
    const plan = planSkillStaging<Stageable>(
      [{ slug: 'review-code' }, { slug: 'write-notes' }],
      slugOf,
      ['review-code'],
    );

    expect(plan.staged).toEqual([{ slug: 'write-notes' }]);
    expect(plan.superseded).toEqual(['review-code']);
  });

  it('stages everything when the repository ships no skills', () => {
    const plan = planSkillStaging<Stageable>(
      [{ slug: 'review-code' }, { slug: 'write-notes' }],
      slugOf,
      [],
    );

    expect(plan.staged).toEqual([
      { slug: 'review-code' },
      { slug: 'write-notes' },
    ]);
    expect(plan.superseded).toEqual([]);
  });

  it('withholds every colliding skill and keeps the offered order', () => {
    const plan = planSkillStaging<Stageable>(
      [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }],
      slugOf,
      new Set(['b', 'd']),
    );

    expect(plan.staged.map(slugOf)).toEqual(['a', 'c']);
    expect(plan.superseded).toEqual(['b', 'd']);
  });

  it('matches slugs exactly — a near-miss is not a collision', () => {
    const plan = planSkillStaging<Stageable>(
      [{ slug: 'review-code' }],
      slugOf,
      ['review-codes', 'Review-Code', 'review_code'],
    );

    expect(plan.staged.map(slugOf)).toEqual(['review-code']);
    expect(plan.superseded).toEqual([]);
  });

  it('ignores repository skills Tale was never going to stage', () => {
    const plan = planSkillStaging<Stageable>([{ slug: 'a' }], slugOf, [
      'b',
      'c',
    ]);

    expect(plan.staged.map(slugOf)).toEqual(['a']);
    expect(plan.superseded).toEqual([]);
  });
});
