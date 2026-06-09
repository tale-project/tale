import { describe, expect, it } from 'vitest';

import {
  agentJsonSchema,
  agentRoutingSchema,
  responseTuningSchema,
} from './agents';

const baseAgent = {
  displayName: 'Test',
  systemInstructions: 'You are a test agent.',
  supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
};

describe('responseTuningSchema', () => {
  it('accepts a full valid config', () => {
    const r = responseTuningSchema.safeParse({
      effort: 'high',
      creativity: 'precise',
      style: 'concise',
      verbosity: 'terse',
      effortFloor: 'low',
      effortCeiling: 'high',
      budgetCaps: { easy: 1024, medium: 4096, hard: 16384 },
      temperatureRange: { min: 0.2, max: 0.8 },
      qualityProfile: 'strict',
    });
    expect(r.success).toBe(true);
  });

  it('rejects temperatureRange with min > max', () => {
    const r = responseTuningSchema.safeParse({
      temperatureRange: { min: 0.9, max: 0.2 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects effortFloor > effortCeiling', () => {
    const r = responseTuningSchema.safeParse({
      effortFloor: 'high',
      effortCeiling: 'low',
    });
    expect(r.success).toBe(false);
  });

  it('rejects out-of-range budget caps', () => {
    expect(
      responseTuningSchema.safeParse({ budgetCaps: { easy: 1 } }).success,
    ).toBe(false);
    expect(
      responseTuningSchema.safeParse({ budgetCaps: { hard: 999999 } }).success,
    ).toBe(false);
  });

  it('rejects unknown enum values', () => {
    expect(responseTuningSchema.safeParse({ effort: 'turbo' }).success).toBe(
      false,
    );
  });
});

describe('agentRoutingSchema', () => {
  it('accepts auto selection + cascade with a draft model', () => {
    const r = agentRoutingSchema.safeParse({
      modelSelection: 'auto',
      cascade: true,
      cascadeDraftModel: 'openrouter:deepseek/deepseek-v4-flash',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid draft model ref', () => {
    const r = agentRoutingSchema.safeParse({ cascadeDraftModel: ':bad:' });
    expect(r.success).toBe(false);
  });
});

describe('agentJsonSchema carries the new optional blocks', () => {
  it('accepts an agent with responseTuning + routing', () => {
    const r = agentJsonSchema.safeParse({
      ...baseAgent,
      responseTuning: { effort: 'medium', qualityProfile: 'balanced' },
      routing: { modelSelection: 'auto' },
    });
    expect(r.success).toBe(true);
  });

  it('still accepts an agent without them (back-compat)', () => {
    expect(agentJsonSchema.safeParse(baseAgent).success).toBe(true);
  });
});
