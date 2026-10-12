import { describe, expect, it } from 'vitest';

import { RAIL_FULL_MAX, windowWizardSteps } from './wizard-progress';

/**
 * The numbered rail collapses long flows to at most ~4 circles with "…" gaps
 * (owner ask: "not more than 4 steps at the time … like 1, 2, … and 10").
 */
describe('windowWizardSteps', () => {
  // Render the rail as human-readable step numbers / "…" for readable asserts.
  const shape = (total: number, active: number) =>
    windowWizardSteps(total, active).map((item) =>
      item.kind === 'ellipsis' ? '…' : item.index + 1,
    );
  const stepCount = (total: number, active: number) =>
    windowWizardSteps(total, active).filter((i) => i.kind === 'step').length;

  it('shows every step for a short rail (≤ RAIL_FULL_MAX)', () => {
    expect(shape(RAIL_FULL_MAX, 2)).toEqual(
      Array.from({ length: RAIL_FULL_MAX }, (_, i) => i + 1),
    );
    expect(
      windowWizardSteps(RAIL_FULL_MAX, 2).some((i) => i.kind === 'ellipsis'),
    ).toBe(false);
  });

  it('collapses a 5-step rail to at most four numbered circles', () => {
    for (let active = 0; active < 5; active++) {
      expect(stepCount(5, active)).toBeLessThanOrEqual(4);
    }
  });

  it('collapses a long rail to "1, 2, …, 10" on the first step', () => {
    expect(shape(10, 0)).toEqual([1, 2, '…', 10]);
  });

  it('keeps context on the last step ("1, …, 9, 10")', () => {
    expect(shape(10, 9)).toEqual([1, '…', 9, 10]);
  });

  it('brackets the current step in the middle ("1, …, 5, 6, …, 10")', () => {
    expect(shape(10, 4)).toEqual([1, '…', 5, 6, '…', 10]);
  });

  it('never shows more than four numbered steps, and always the ends + current', () => {
    for (let active = 0; active < 10; active++) {
      expect(stepCount(10, active)).toBeLessThanOrEqual(4);
      const indices = windowWizardSteps(10, active).flatMap((i) =>
        i.kind === 'step' ? [i.index] : [],
      );
      expect(indices).toContain(0);
      expect(indices).toContain(9);
      expect(indices).toContain(active);
    }
  });

  it('handles an empty rail', () => {
    expect(windowWizardSteps(0, 0)).toEqual([]);
  });
});
