// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGovernancePolicyToggle } from './use-governance-policy-toggle';

const mutateAsync = vi.fn();
let isPending = false;
const toastMock = vi.fn();

vi.mock('./mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync, isPending }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const baseOpts = {
  organizationId: 'org-1',
  policyType: 'login_policy',
  savedEnabled: false,
  isLoading: false,
  buildConfig: (next: boolean) => ({ enabled: next }),
  failureTitle: 'Save failed',
  failureDescription: 'Could not save the policy',
};

beforeEach(() => {
  mutateAsync.mockReset();
  toastMock.mockReset();
  isPending = false;
});

describe('useGovernancePolicyToggle', () => {
  it('seeds enabled from the persisted value once loaded', () => {
    const { result } = renderHook(() =>
      useGovernancePolicyToggle({ ...baseOpts, savedEnabled: true }),
    );
    expect(result.current.enabled).toBe(true);
  });

  it('does not seed while still loading', () => {
    const { result } = renderHook(() =>
      useGovernancePolicyToggle({
        ...baseOpts,
        savedEnabled: true,
        isLoading: true,
      }),
    );
    expect(result.current.enabled).toBe(false);
  });

  it('flips and persists the built config on success, without toasting', async () => {
    mutateAsync.mockResolvedValue(undefined);
    const { result } = renderHook(() => useGovernancePolicyToggle(baseOpts));

    await act(async () => {
      await result.current.onToggle(true);
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      policyType: 'login_policy',
      config: { enabled: true },
    });
    expect(result.current.enabled).toBe(true);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('reverts the optimistic flip and toasts on failure', async () => {
    mutateAsync.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useGovernancePolicyToggle(baseOpts));

    await act(async () => {
      await result.current.onToggle(true);
    });

    expect(result.current.enabled).toBe(false);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save failed',
        description: 'Could not save the policy',
        variant: 'destructive',
      }),
    );
    errorSpy.mockRestore();
  });
});
