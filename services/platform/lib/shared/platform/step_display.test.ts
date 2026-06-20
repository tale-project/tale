import { describe, expect, it } from 'vitest';

import {
  isStepVisible,
  stepTreatment,
  type StepTreatment,
} from './step_display';

describe('stepTreatment', () => {
  // The issue-desk workflow's 9 steps — the ground-truth truth table both the
  // friendly map and the run view must agree on. Spine = implement → review →
  // judge (gate) → to_review; everything else collapses out.
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
      slug: 'implement',
      stepType: 'sandbox',
      hasUi: true,
      expected: 'normal',
    },
    {
      slug: 'impl_check',
      stepType: 'condition',
      hasUi: false,
      expected: 'hidden',
    },
    {
      slug: 'impl_failed',
      stepType: 'action',
      hasUi: false,
      expected: 'hidden',
    },
    { slug: 'review', stepType: 'sandbox', hasUi: true, expected: 'normal' },
    {
      slug: 'judge',
      stepType: 'llm',
      hasUi: true,
      display: 'gate',
      expected: 'gate',
    },
    {
      slug: 'judge_decision',
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

  it('hides only 6 of the 9 desk steps, leaving the 4-step spine', () => {
    const visible = deskSteps.filter((s) =>
      isStepVisible({
        stepType: s.stepType,
        hasUi: s.hasUi,
        ...(s.display !== undefined && { display: s.display }),
      }),
    );
    expect(visible.map((s) => s.slug)).toEqual([
      'implement',
      'review',
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
