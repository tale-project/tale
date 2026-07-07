import { describe, expect, it } from 'vitest';

import {
  dedupeSpineLanes,
  isStepVisible,
  pruneBypassedLanes,
  stepTreatment,
  type SpineLaneInput,
  type StepTreatment,
} from './step_display';

describe('stepTreatment', () => {
  // The issue-desk v2.1 workflow's representative steps — the ground-truth
  // table both the friendly map and the run view must agree on. Spine =
  // advise → review gate → execute → grade → judge (gate) → dream → park;
  // plumbing collapses out.
  const deskSteps: {
    slug: string;
    stepType: string;
    hasUi: boolean;
    display?: string;
    expected: StepTreatment;
  }[] = [
    { slug: 'start', stepType: 'start', hasUi: false, expected: 'hidden' },
    { slug: 'ack', stepType: 'action', hasUi: false, expected: 'hidden' },
    {
      slug: 'advise',
      stepType: 'sandbox',
      hasUi: true,
      expected: 'normal',
    },
    {
      slug: 'advise_gate',
      stepType: 'condition',
      hasUi: false,
      expected: 'hidden',
    },
    {
      slug: 'execute',
      stepType: 'sandbox',
      hasUi: true,
      expected: 'normal',
    },
    {
      slug: 'execute_check',
      stepType: 'condition',
      hasUi: false,
      expected: 'hidden',
    },
    {
      slug: 'execute_failed_rollback',
      stepType: 'action',
      hasUi: false,
      expected: 'hidden',
    },
    { slug: 'grade', stepType: 'sandbox', hasUi: true, expected: 'normal' },
    {
      slug: 'judge',
      stepType: 'llm',
      hasUi: true,
      display: 'gate',
      expected: 'gate',
    },
    {
      slug: 'judge_pass',
      stepType: 'condition',
      hasUi: false,
      expected: 'hidden',
    },
    {
      slug: 'park_approved',
      stepType: 'action',
      hasUi: true,
      expected: 'normal',
    },
    {
      slug: 'advise_failed_rollback',
      stepType: 'action',
      hasUi: false,
      expected: 'hidden',
    },
    { slug: 'done', stepType: 'output', hasUi: false, expected: 'hidden' },
  ];

  for (const step of deskSteps) {
    it(`desk step "${step.slug}" (${step.stepType}) → ${step.expected}`, () => {
      expect(
        stepTreatment({
          stepType: step.stepType,
          hasUi: step.hasUi,
          ...(step.display !== undefined && { display: step.display }),
        }),
      ).toBe(step.expected);
    });
  }

  it('hides plumbing steps, leaving the five-step operator spine', () => {
    const visible = deskSteps.filter((s) =>
      isStepVisible({
        stepType: s.stepType,
        hasUi: s.hasUi,
        ...(s.display !== undefined && { display: s.display }),
      }),
    );
    expect(visible.map((s) => s.slug)).toEqual([
      'advise',
      'execute',
      'grade',
      'judge',
      'park_approved',
    ]);
  });

  it('an unannotated llm step is a quiet gate, not hidden', () => {
    expect(stepTreatment({ stepType: 'llm', hasUi: false })).toBe('gate');
  });

  it('display:gate wins even on a plain action step', () => {
    expect(
      stepTreatment({ stepType: 'action', hasUi: true, display: 'gate' }),
    ).toBe('gate');
  });

  it('an unannotated non-plumbing step (e.g. sandbox) shows normally', () => {
    expect(stepTreatment({ stepType: 'sandbox', hasUi: false })).toBe('normal');
  });
});

describe('dedupeSpineLanes', () => {
  // The issue-desk v2.1 pattern: four park variants (approved / exhausted /
  // failed-grade / replan-exhausted) share the markInReview labelKey; the
  // work steps are singletons.
  const lane = (labelKey: string | undefined, hasRun: boolean) =>
    ({ ...(labelKey !== undefined && { labelKey }), hasRun }) as SpineLaneInput;
  const desk = (ran: string[]) => {
    const slugs = [
      ['advise', 'issueDesk.advise'],
      ['request_plan_review', 'issueDesk.planReview'],
      ['execute', 'issueDesk.implement'],
      ['grade', 'issueDesk.review'],
      ['dream', 'issueDesk.dream'],
      ['plan_review_exhausted', 'issueDesk.markInReview'],
      ['grade_failed_park', 'issueDesk.markInReview'],
      ['replan_exhausted', 'issueDesk.markInReview'],
      ['park_approved', 'issueDesk.markInReview'],
      ['loops_exhausted', 'issueDesk.markInReview'],
    ] as const;
    return {
      slugs: slugs.map(([slug]) => slug),
      lanes: slugs.map(([slug, key]) => lane(key, ran.includes(slug))),
    };
  };

  it('collapses un-run branch variants to one upcoming placeholder each', () => {
    const { slugs, lanes } = desk(['advise']);
    const kept = dedupeSpineLanes(lanes).map((i) => slugs[i]);
    expect(kept).toEqual([
      'advise',
      'request_plan_review',
      'execute',
      'grade',
      'dream',
      'plan_review_exhausted',
    ]);
  });

  it('a ran variant replaces the placeholder and hides its siblings', () => {
    const { slugs, lanes } = desk(['advise', 'park_approved']);
    const kept = dedupeSpineLanes(lanes).map((i) => slugs[i]);
    expect(kept).toContain('park_approved');
    expect(kept).not.toContain('plan_review_exhausted');
    expect(kept).not.toContain('loops_exhausted');
  });

  it('keeps every variant the run actually touched', () => {
    const { slugs, lanes } = desk(['grade_failed_park', 'park_approved']);
    const kept = dedupeSpineLanes(lanes).map((i) => slugs[i]);
    expect(kept).toContain('grade_failed_park');
    expect(kept).toContain('park_approved');
    expect(kept).not.toContain('plan_review_exhausted');
  });

  it('never groups steps without a labelKey', () => {
    const kept = dedupeSpineLanes([
      lane(undefined, false),
      lane(undefined, false),
      lane(undefined, true),
    ]);
    expect(kept).toEqual([0, 1, 2]);
  });
});

describe('pruneBypassedLanes', () => {
  const lanes = (entries: Array<[hasRun: boolean, defIndex: number]>) =>
    entries.map(([hasRun, defIndex]) => ({ hasRun, defIndex }));

  it('drops a skipped gate the run already moved past', () => {
    // advise(2) ran, review gate(4) skipped, execute(6) running →
    // lastTouched = 6; the gate is neither run nor ahead.
    const kept = pruneBypassedLanes(
      lanes([
        [true, 2],
        [false, 4],
        [true, 6],
        [false, 9],
      ]),
      6,
    );
    expect(kept).toEqual([0, 2, 3]);
  });

  it('keeps the full preview before anything ran', () => {
    const kept = pruneBypassedLanes(
      lanes([
        [false, 2],
        [false, 4],
        [false, 6],
      ]),
      -1,
    );
    expect(kept).toEqual([0, 1, 2]);
  });

  it('always keeps steps that ran, wherever progress sits', () => {
    const kept = pruneBypassedLanes(
      lanes([
        [true, 2],
        [true, 4],
        [false, 3],
      ]),
      8,
    );
    expect(kept).toEqual([0, 1]);
  });
});
