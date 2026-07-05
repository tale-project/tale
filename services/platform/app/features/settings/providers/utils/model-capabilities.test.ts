import { describe, expect, it } from 'vitest';

import type { ModelInfoCapabilities } from '@/app/features/chat/components/model-info-popover';

import {
  mergeModelCapabilities,
  modelCapabilitiesFromConfig,
} from './model-capabilities';

describe('modelCapabilitiesFromConfig', () => {
  it('projects the operator-declared capability fields', () => {
    expect(
      modelCapabilitiesFromConfig({
        tags: ['chat'],
        maxOutputTokens: 8192,
        contextWindow: 200_000,
        reasoning: { knob: 'budgetTokens' },
        promptCaching: { mode: 'explicit-breakpoints' },
        cost: { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
      }),
    ).toEqual({
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      inputCentsPerMillion: 300,
      outputCentsPerMillion: 1500,
      reasoning: { knob: 'budgetTokens' },
      promptCaching: { mode: 'explicit-breakpoints' },
      supportsVision: undefined,
    });
  });

  it('derives supportsVision from the vision tag but never asserts false', () => {
    expect(
      modelCapabilitiesFromConfig({ tags: ['chat', 'vision'] }).supportsVision,
    ).toBe(true);
    expect(
      modelCapabilitiesFromConfig({ tags: ['chat'] }).supportsVision,
    ).toBeUndefined();
  });
});

describe('mergeModelCapabilities', () => {
  const catalog: ModelInfoCapabilities = {
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    inputCentsPerMillion: 250,
    outputCentsPerMillion: 1000,
    supportsTools: true,
    supportsVision: false,
  };

  it('returns the org-config fields when the catalog is absent (pre-sync)', () => {
    const config = modelCapabilitiesFromConfig({
      tags: ['chat'],
      contextWindow: 200_000,
      reasoning: { knob: 'effort' },
    });
    expect(mergeModelCapabilities(config, undefined)).toBe(config);
  });

  it('returns the catalog when there is no org-config entry', () => {
    expect(mergeModelCapabilities(undefined, catalog)).toBe(catalog);
  });

  it('prefers org-config fields and fills the rest from the catalog', () => {
    const config = modelCapabilitiesFromConfig({
      tags: ['chat', 'vision'],
      contextWindow: 200_000,
      reasoning: { knob: 'budgetTokens' },
    });
    expect(mergeModelCapabilities(config, catalog)).toEqual({
      contextWindow: 200_000,
      maxOutputTokens: 4096,
      inputCentsPerMillion: 250,
      outputCentsPerMillion: 1000,
      reasoning: { knob: 'budgetTokens' },
      promptCaching: undefined,
      supportsTools: true,
      supportsVision: true,
    });
  });

  it('returns undefined when both sides are absent', () => {
    expect(mergeModelCapabilities(undefined, undefined)).toBeUndefined();
  });
});
