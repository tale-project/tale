// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';

import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';

import {
  useWorkflowConfig,
  WorkflowConfigProvider,
} from './use-workflow-config-context';

const BASE: WorkflowJsonConfig = {
  // Minimal shape — the context only cares about `steps` for its helpers.
  steps: [
    // oxlint-disable-next-line typescript/no-explicit-any -- test fixture
    { stepSlug: 'a', nextSteps: {} } as any,
  ],
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture
} as WorkflowJsonConfig;

function wrapper(initial: WorkflowJsonConfig) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <WorkflowConfigProvider workflowSlug="wf" initialConfig={initial}>
        {children}
      </WorkflowConfigProvider>
    );
  };
}

describe('useWorkflowConfig', () => {
  it('starts clean, dirties on addStep', () => {
    const { result } = renderHook(() => useWorkflowConfig(), {
      wrapper: wrapper(BASE),
    });
    expect(result.current.isDirty).toBe(false);

    act(() =>
      // oxlint-disable-next-line typescript/no-explicit-any -- test fixture
      result.current.addStep({ stepSlug: 'b', nextSteps: {} } as any),
    );
    expect(result.current.isDirty).toBe(true);
    expect(result.current.config.steps).toHaveLength(2);
  });

  it('clears dirty after markSaving(false) even though config did not change again (regression)', () => {
    const { result } = renderHook(() => useWorkflowConfig(), {
      wrapper: wrapper(BASE),
    });
    act(() =>
      // oxlint-disable-next-line typescript/no-explicit-any -- test fixture
      result.current.addStep({ stepSlug: 'b', nextSteps: {} } as any),
    );
    expect(result.current.isDirty).toBe(true);

    // Simulate a save lifecycle: the only signal is markSaving(true/false).
    act(() => result.current.markSaving(true));
    act(() => result.current.markSaving(false));
    expect(result.current.isDirty).toBe(false);
  });

  it('deleteStep removes the step and clears inbound references', () => {
    const initial: WorkflowJsonConfig = {
      steps: [
        // oxlint-disable-next-line typescript/no-explicit-any -- test fixture
        { stepSlug: 'a', nextSteps: { default: 'b' } } as any,
        // oxlint-disable-next-line typescript/no-explicit-any -- test fixture
        { stepSlug: 'b', nextSteps: {} } as any,
      ],
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture
    } as WorkflowJsonConfig;
    const { result } = renderHook(() => useWorkflowConfig(), {
      wrapper: wrapper(initial),
    });

    act(() => result.current.deleteStep('b'));
    expect(result.current.config.steps).toHaveLength(1);
    expect(result.current.config.steps[0]?.nextSteps).toEqual({ default: '' });
  });

  it('resetConfig reverts edits', () => {
    const { result } = renderHook(() => useWorkflowConfig(), {
      wrapper: wrapper(BASE),
    });
    act(() => result.current.updateStep('a', { stepSlug: 'a' }));
    act(() =>
      // oxlint-disable-next-line typescript/no-explicit-any -- test fixture
      result.current.addStep({ stepSlug: 'z', nextSteps: {} } as any),
    );
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.resetConfig());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.config.steps).toHaveLength(1);
  });
});
