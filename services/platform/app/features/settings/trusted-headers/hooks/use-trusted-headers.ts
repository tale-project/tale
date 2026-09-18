import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useBackendQuery } from '@/app/hooks/use-backend-query';

/**
 * Data hooks for the trusted-headers card: the organization's switch, role
 * ceiling and keys, and the three writes behind them. The read is keyed
 * under the `trusted_headers` entity, which every write invalidates.
 */

export function useTrustedHeaders(organizationId: string) {
  return useBackendQuery('trusted_headers/queries:get', { organizationId });
}

export function useSetTrustedHeaderSettings() {
  return useBackendMutation('trusted_headers/mutations:setSettings');
}

/** Mints a key — the answer carries the plaintext exactly once. */
export function useCreateTrustedHeaderKey() {
  return useBackendMutation('trusted_headers/mutations:createKey');
}

export function useRevokeTrustedHeaderKey() {
  return useBackendMutation('trusted_headers/mutations:revokeKey');
}
