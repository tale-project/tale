import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * The calling user's sandbox env/secrets for the active org. Secrets are
 * write-only: only `maskedValue` comes back for them, never the plaintext.
 * `undefined` while loading (the section's skeleton vs empty-state split).
 */
export function useMyEnv(organizationId: string) {
  const { data } = useConvexQuery(api.sandbox.user_env.listMyEnv, {
    organizationId,
  });
  return data;
}
