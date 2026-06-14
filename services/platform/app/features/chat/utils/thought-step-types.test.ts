import { describe, expect, it } from 'vitest';

import {
  subAgentReport,
  subAgentSteps,
  type ThoughtStep,
} from './thought-step-types';

const tool = (output: unknown): Extract<ThoughtStep, { kind: 'tool' }> => ({
  kind: 'tool',
  id: 'task1',
  toolName: 'Task',
  state: 'output-available',
  output,
});

describe('subAgentSteps / subAgentReport', () => {
  it('returns the folded steps array when present and non-empty', () => {
    const steps = [{ toolName: 'WebSearch', output: 'hits' }];
    expect(subAgentSteps(tool({ report: 'r', steps }))).toEqual(steps);
  });

  it('returns undefined for a plain (non-folded) output', () => {
    expect(subAgentSteps(tool('plain string output'))).toBeUndefined();
    expect(subAgentSteps(tool(undefined))).toBeUndefined();
    expect(subAgentSteps(tool({ report: 'r', steps: [] }))).toBeUndefined();
    expect(subAgentSteps(tool({ other: 1 }))).toBeUndefined();
  });

  it('extracts a non-empty report string, else undefined', () => {
    expect(subAgentReport(tool({ report: '## R', steps: [] }))).toBe('## R');
    expect(subAgentReport(tool({ report: '   ', steps: [] }))).toBeUndefined();
    expect(subAgentReport(tool('plain'))).toBeUndefined();
  });
});
