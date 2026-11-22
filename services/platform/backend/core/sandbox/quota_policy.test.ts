// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SANDBOX_QUOTA,
  requireSessionBudgetForOwnerType,
  sessionBudgetForOwnerType,
  sessionCapFor,
} from './quota_policy';

describe('which budget a sandbox session draws on', () => {
  it.each([
    ['render', 'render'],
    // A video link's session is a render session's kind: the deployment's
    // own, for an organization's knowledge work, minutes long.
    ['video', 'render'],
    ['light', 'light'],
    ['workflow_run', 'workflow'],
    ['project_agent', 'project'],
    ['user', 'project'],
  ])('a %s session draws on the %s budget', (ownerType, budget) => {
    expect(sessionBudgetForOwnerType(ownerType)).toBe(budget);
    expect(requireSessionBudgetForOwnerType(ownerType)).toBe(budget);
  });

  it('counts the retired per-thread lane against no budget, and starts none in it', () => {
    expect(sessionBudgetForOwnerType('thread')).toBeNull();
    expect(() => requireSessionBudgetForOwnerType('thread')).toThrow(
      "Sandbox sessions owned by 'thread' can no longer be created or resumed.",
    );
  });

  it('caps a video session with the render sessions it shares a budget with', () => {
    const budget = requireSessionBudgetForOwnerType('video');

    expect(sessionCapFor(budget, DEFAULT_SANDBOX_QUOTA)).toBe(
      DEFAULT_SANDBOX_QUOTA.maxRenderSessionsPerOrg,
    );
  });
});
