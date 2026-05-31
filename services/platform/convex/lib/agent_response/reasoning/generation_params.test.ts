import { describe, expect, it } from 'vitest';

import type { ReasoningCapability } from './capability';
import { decideTemperature } from './generation_params';

const EFFORT: ReasoningCapability = { knob: 'effort', selfTruncates: false };
const BUDGET: ReasoningCapability = {
  knob: 'budgetTokens',
  selfTruncates: true,
  minBudgetTokens: 1024,
};

describe('decideTemperature', () => {
  it('leaves temperature unset for effort-knob models (unsupported)', () => {
    expect(decideTemperature(0.9, EFFORT, true)).toBeUndefined();
    expect(decideTemperature(0.1, EFFORT, false)).toBeUndefined();
  });

  it('leaves temperature unset for self-truncating models while thinking is active', () => {
    expect(decideTemperature(0.5, BUDGET, true)).toBeUndefined();
  });

  it('sets temperature for self-truncating models when reasoning is off', () => {
    expect(decideTemperature(0.5, BUDGET, false)).toBeGreaterThan(0);
  });

  it('sets temperature for non-reasoning models, scaled by creativity', () => {
    const cool = decideTemperature(0, null, false);
    const warm = decideTemperature(1, null, false);
    expect(cool).toBeDefined();
    expect(warm).toBeDefined();
    expect(cool as number).toBeLessThan(warm as number);
    expect(cool as number).toBeGreaterThanOrEqual(0.4);
    expect(warm as number).toBeLessThanOrEqual(0.9);
  });
});
