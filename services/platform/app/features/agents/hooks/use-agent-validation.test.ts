import { describe, expect, it } from 'vitest';

import type { AgentJsonConfig } from '@/convex/agents/file_utils';

import { computeAgentValidation } from './use-agent-validation';

/** Minimal valid chat agent — the baseline each case perturbs. */
function baseConfig(overrides: Partial<AgentJsonConfig> = {}): AgentJsonConfig {
  return {
    displayName: 'Support Agent',
    systemInstructions: 'Help the user.',
    supportedModels: ['openai:gpt-4o'],
    ...overrides,
  };
}

describe('computeAgentValidation', () => {
  it('accepts a complete chat agent', () => {
    const result = computeAgentValidation(baseConfig());
    expect(result.isValid).toBe(true);
    expect(result.invalidFields.size).toBe(0);
  });

  it('flags a missing display name (#2665)', () => {
    const result = computeAgentValidation(
      baseConfig({ displayName: undefined }),
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidFields.has('displayName')).toBe(true);
  });

  it('accepts a display name provided only via an i18n locale', () => {
    const result = computeAgentValidation(
      baseConfig({
        displayName: undefined,
        i18n: { de: { displayName: 'Support-Agent' } },
      }),
    );
    expect(result.isValid).toBe(true);
  });

  it('flags missing system instructions for a chat agent (#2665)', () => {
    const result = computeAgentValidation(
      baseConfig({ systemInstructions: undefined }),
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidFields.has('systemInstructions')).toBe(true);
  });

  it('flags an empty model list for a chat agent (#2665)', () => {
    const result = computeAgentValidation(baseConfig({ supportedModels: [] }));
    expect(result.isValid).toBe(false);
    expect(result.invalidFields.has('supportedModels')).toBe(true);
  });

  it('exempts a BYO external agent from the model floor (schema parity)', () => {
    const result = computeAgentValidation(
      baseConfig({
        primaryBehavior: 'external-agent',
        authMode: 'byo',
        supportedModels: [],
      }),
    );
    expect(result.isValid).toBe(true);
  });

  it('reports multiple offending fields at once', () => {
    const result = computeAgentValidation(
      baseConfig({
        displayName: undefined,
        systemInstructions: undefined,
        supportedModels: [],
      }),
    );
    expect(result.isValid).toBe(false);
    expect([...result.invalidFields].sort()).toEqual([
      'displayName',
      'supportedModels',
      'systemInstructions',
    ]);
  });
});
