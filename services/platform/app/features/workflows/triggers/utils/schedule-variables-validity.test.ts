import { describe, expect, it } from 'vitest';

import type { InputSchema } from '../../utils/input-schema-template';
import { computeScheduleVariablesValidity } from './schedule-variables-validity';

const SCHEMA: InputSchema = {
  properties: {
    owner: { type: 'string' },
    repo: { type: 'string' },
  },
  required: ['owner', 'repo'],
};

describe('computeScheduleVariablesValidity', () => {
  it('is always valid when the workflow declares no inputSchema', () => {
    const result = computeScheduleVariablesValidity({
      hasInputSchema: false,
      inputSchema: undefined,
      mode: 'form',
      parsedJson: null,
      effectiveVariables: {},
      deriveInvalidCount: 0,
    });
    expect(result.variablesValid).toBe(true);
    expect(result.missingRequiredFields).toEqual([]);
  });

  // Regression for #2608: saving used to skip `getMissingRequiredFields`
  // entirely, so an empty required field never blocked the save.
  it('blocks save in form mode when a required field is blank', () => {
    const result = computeScheduleVariablesValidity({
      hasInputSchema: true,
      inputSchema: SCHEMA,
      mode: 'form',
      parsedJson: null,
      effectiveVariables: { owner: 'acme', repo: '' },
      deriveInvalidCount: 0,
    });
    expect(result.variablesValid).toBe(false);
    expect(result.missingRequiredFields).toEqual(['repo']);
    expect(result.missingRequiredSet.has('repo')).toBe(true);
  });

  it('blocks save in form mode when the combined field failed to derive', () => {
    const result = computeScheduleVariablesValidity({
      hasInputSchema: true,
      inputSchema: SCHEMA,
      mode: 'form',
      parsedJson: null,
      effectiveVariables: { owner: 'acme', repo: 'widgets' },
      deriveInvalidCount: 1,
    });
    expect(result.variablesValid).toBe(false);
  });

  it('allows save in form mode once every required field is set', () => {
    const result = computeScheduleVariablesValidity({
      hasInputSchema: true,
      inputSchema: SCHEMA,
      mode: 'form',
      parsedJson: null,
      effectiveVariables: { owner: 'acme', repo: 'widgets' },
      deriveInvalidCount: 0,
    });
    expect(result.variablesValid).toBe(true);
    expect(result.missingRequiredFields).toEqual([]);
  });

  it('blocks save in JSON mode when the text is not valid JSON', () => {
    const result = computeScheduleVariablesValidity({
      hasInputSchema: true,
      inputSchema: SCHEMA,
      mode: 'json',
      parsedJson: null,
      effectiveVariables: {},
      deriveInvalidCount: 0,
    });
    expect(result.jsonIsValid).toBe(false);
    expect(result.variablesValid).toBe(false);
  });

  it('blocks save in JSON mode when required fields are still blank', () => {
    const parsed = { owner: 'acme', repo: '' };
    const result = computeScheduleVariablesValidity({
      hasInputSchema: true,
      inputSchema: SCHEMA,
      mode: 'json',
      parsedJson: parsed,
      effectiveVariables: parsed,
      deriveInvalidCount: 0,
    });
    expect(result.jsonIsValid).toBe(true);
    expect(result.variablesValid).toBe(false);
    expect(result.missingRequiredFields).toEqual(['repo']);
  });

  it('allows save in JSON mode once the JSON is valid and complete', () => {
    const parsed = { owner: 'acme', repo: 'widgets' };
    const result = computeScheduleVariablesValidity({
      hasInputSchema: true,
      inputSchema: SCHEMA,
      mode: 'json',
      parsedJson: parsed,
      effectiveVariables: parsed,
      deriveInvalidCount: 0,
    });
    expect(result.variablesValid).toBe(true);
  });
});
