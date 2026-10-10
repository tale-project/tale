// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { defaultRunnerProcesses } from './code-runner';

describe('the runner processes a role spends by default', () => {
  it('gives the api two, and a worker one per core but one, at most four', () => {
    expect(defaultRunnerProcesses('api', 12)).toBe(2);
    expect(defaultRunnerProcesses('worker', 12)).toBe(4);
    expect(defaultRunnerProcesses('all', 3)).toBe(2);
    expect(defaultRunnerProcesses('worker', 1)).toBe(1);
  });
});
