'use client';

import { useMutation } from '@tanstack/react-query';

import { useConvexClient } from '@/app/hooks/use-convex-client';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import type { ReturnsOf } from '@/app/lib/backend/contract';

/** Result of a one-shot chain verification (`verifyIntegrity`). */
export type VerifyIntegrityResult =
  ReturnsOf<'audit_logs/verify_integrity:verifyIntegrity'>;

/** Admin snapshot of the scheduled integrity-check state, or `null` if never run. */
export type IntegrityStatus =
  ReturnsOf<'audit_logs/verify_integrity:getIntegrityStatus'>;

/**
 * Upper bound on the on-demand walk. `verifyIntegrity` walks the hash chain on
 * read, so one click verifies at most this many live rows and reports
 * `truncated: true` when the chain is longer — the panel surfaces that so an
 * admin knows the tail is unchecked.
 */
const VERIFY_MAX_ENTRIES = 1000;

/**
 * Live status of the scheduled integrity check. Reads the single per-org
 * progress row (cheap — no chain walk), so subscribing on mount is safe.
 * Admin-gated server-side; only mount this for admins.
 */
export function useIntegrityStatus(organizationId: string) {
  return useConvexQuery('audit_logs/verify_integrity:getIntegrityStatus', {
    organizationId,
  });
}

/**
 * On-demand chain verification. `verifyIntegrity` is a query that WALKS the
 * chain, so it must never be a mount subscription: this fires it as a one-shot
 * `client.query` behind a react-query mutation (click → `mutate`), exposing
 * `data` / `isPending` / `isError` for the panel.
 */
export function useVerifyIntegrity() {
  const client = useConvexClient();
  return useMutation<VerifyIntegrityResult, Error, { organizationId: string }>({
    mutationFn: ({ organizationId }) =>
      client.query('audit_logs/verify_integrity:verifyIntegrity', {
        organizationId,
        maxEntries: VERIFY_MAX_ENTRIES,
      }),
  });
}
