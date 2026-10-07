import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCancelPendingDsarPolicyChange,
  useProposeDsarPolicy,
  useUpsertGovernancePolicy,
  useUpsertRetentionPolicy,
} from './mutations';
import { PolicyReadAccessContext } from './policy-read-access';

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
const access = { current: true };

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: (name: string, options: { onMutate: () => void }) => ({
    mutateAsync: async () => {
      options.onMutate();
      return transport(name);
    },
  }),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (name: string, options: { onMutate: () => void }) => ({
    mutateAsync: async () => {
      options.onMutate();
      return transport(name);
    },
  }),
}));

beforeEach(() => vi.clearAllMocks());

describe('policy writes require readable policy state', () => {
  it.each([
    useUpsertGovernancePolicy,
    useUpsertRetentionPolicy,
    useProposeDsarPolicy,
    useCancelPendingDsarPolicyChange,
  ])(
    'checks the latest read state before transport (%#)',
    async (useMutation) => {
      access.current = true;
      const wrapper = ({ children }: { children: ReactNode }) => (
        <PolicyReadAccessContext.Provider value={access}>
          {children}
        </PolicyReadAccessContext.Provider>
      );
      const { result } = renderHook(() => useMutation(), { wrapper });
      const mutateAsync = result.current.mutateAsync;
      access.current = false;
      await expect(
        mutateAsync({ organizationId: 'org-1' } as never),
      ).rejects.toThrow('policyReadFailed');
      expect(transport).not.toHaveBeenCalled();
      access.current = true;
      await mutateAsync({ organizationId: 'org-1' } as never);
      expect(transport).toHaveBeenCalledOnce();
    },
  );
});
