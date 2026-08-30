import { useBackendQuery } from '@/app/hooks/use-backend-query';

/**
 * The calling user's sandbox env/secrets for the active org. Secrets are
 * write-only: only `maskedValue` comes back for them, never the plaintext.
 * `undefined` while loading (the section's skeleton vs empty-state split).
 */
export function useMyEnv(organizationId: string) {
  const { data } = useBackendQuery('sandbox/user_env:listMyEnv', {
    organizationId,
  });
  return data;
}
