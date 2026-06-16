import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';

/**
 * The calling user's sandbox env/secrets for the active org. Secrets are
 * write-only: only `maskedValue` comes back for them, never the plaintext.
 */
export function useMyEnv(organizationId: string) {
  return useQuery(api.sandbox.user_env.listMyEnv, { organizationId });
}
