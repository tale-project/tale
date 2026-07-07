import { describe, expect, it } from 'vitest';

import {
  dedupeSpineLanes,
  isStepVisible,
  stepTreatment,
  type SpineLaneInput,
  type StepTreatment,
} from './step_display';

describe('stepTreatment', () => {
  // The issue-desk v2 workflow's representative steps — the ground-truth table
  // both the friendly map and the run view must agree on. Spine = advise →
  // execute → grade → judge (gate) → to_review; plumbing collapses out.
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
      slug: 'execute_failed',
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
      slug: 'to_review',
      stepType: 'action',
      hasUi: true,
      expected: 'normal',
    },
    { slug: 'rollback', stepType: 'action', hasUi: false, expected: 'hidden' },
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
      'to_review',
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
  // The issue-desk v2 pattern: two review-gate variants share one labelKey,
  // three dream variants share another; the work steps are singletons.
  const lane = (labelKey: string | undefined, hasRun: boolean) =>
    ({ ...(labelKey !== undefined && { labelKey }), hasRun }) as SpineLaneInput;
  const desk = (ran: string[]) => {
    const slugs = [
      ['advise', 'issueDesk.advise'],
      ['request_plan_review', 'issueDesk.planReview'],
      ['request_plan_re_review', 'issueDesk.planReview'],
      ['execute', 'issueDesk.implement'],
      ['grade', 'issueDesk.review'],
      ['dream_wrong', 'issueDesk.dream'],
      ['dream_pass', 'issueDesk.dream'],
      ['dream_rework', 'issueDesk.dream'],
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
      'dream_wrong',
    ]);
  });

  it('a ran variant replaces the placeholder and hides its siblings', () => {
    const { slugs, lanes } = desk(['advise', 'request_plan_review']);
    const kept = dedupeSpineLanes(lanes).map((i) => slugs[i]);
    expect(kept).toContain('request_plan_review');
    expect(kept).not.toContain('request_plan_re_review');
    // The dream lane still shows exactly one upcoming placeholder.
    expect(kept.filter((s) => s.startsWith('dream'))).toEqual(['dream_wrong']);
  });

  it('keeps every variant the run actually touched (two review rounds)', () => {
    const { slugs, lanes } = desk([
      'request_plan_review',
      'request_plan_re_review',
      'dream_pass',
    ]);
    const kept = dedupeSpineLanes(lanes).map((i) => slugs[i]);
    expect(kept).toContain('request_plan_review');
    expect(kept).toContain('request_plan_re_review');
    expect(kept.filter((s) => s.startsWith('dream'))).toEqual(['dream_pass']);
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
