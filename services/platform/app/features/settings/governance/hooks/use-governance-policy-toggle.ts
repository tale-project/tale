import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from '@/app/hooks/use-toast';

import { useUpsertGovernancePolicy } from './mutations';

interface GovernancePolicyToggleOptions<C> {
  organizationId: string;
  /** The policy's file-backed type, e.g. `'login_policy'`. */
  policyType: string;
  /** The persisted `enabled` flag; seeds the optimistic mirror once loaded. */
  savedEnabled: boolean;
  isLoading: boolean;
  /** Builds the full policy config to persist for the new toggle state. */
  buildConfig: (next: boolean) => C;
  /** Already-translated destructive-toast strings shown when the save fails. */
  failureTitle: string;
  failureDescription: string;
}

/**
 * Shared logic for a governance policy's instant-save `enabled` header switch:
 * an optimistic local mirror seeded from the persisted value, a save that flips
 * it immediately, and a revert + destructive toast when the save fails. Extracted
 * from the login/upload/session editors, which all reimplemented it identically
 * (only the persisted config shape and the failure copy differ).
 *
 * The switch's `enabled` is a local mirror rather than derived state because the
 * write is a filesystem action with no optimistic cache patch — the reactive
 * `getPolicy` query only updates once the write + cache-sync complete, so the
 * mirror gives immediate feedback and is rolled back by hand on failure.
 */
export function useGovernancePolicyToggle<C>(
  options: GovernancePolicyToggleOptions<C>,
): {
  enabled: boolean;
  isToggling: boolean;
  onToggle: (next: boolean) => Promise<void>;
} {
  const { organizationId, policyType, savedEnabled, isLoading } = options;
  const upsert = useUpsertGovernancePolicy();
  const [enabled, setEnabled] = useState(false);

  // Seed the optimistic mirror from the persisted value once the read settles
  // (the leaf would otherwise flash `false` for a frame before data arrives).
  useEffect(() => {
    if (!isLoading) setEnabled(savedEnabled);
  }, [isLoading, savedEnabled]);

  // Keep the latest config-builder + copy in a ref so `onToggle` stays
  // referentially stable while still reading fresh values (the saved config and
  // locale change between renders without re-creating the handler).
  const latest = useRef(options);
  latest.current = options;

  const onToggle = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      const { buildConfig, failureTitle, failureDescription } = latest.current;
      try {
        await upsert.mutateAsync({
          organizationId,
          policyType,
          config: buildConfig(next),
        });
      } catch (err) {
        console.error(`[${policyType} toggle]`, err);
        setEnabled(!next);
        toast({
          title: failureTitle,
          description: failureDescription,
          variant: 'destructive',
        });
      }
    },
    [upsert, organizationId, policyType],
  );

  return { enabled, isToggling: upsert.isPending, onToggle };
}
