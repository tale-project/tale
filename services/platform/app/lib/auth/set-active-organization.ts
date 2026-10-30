/**
 * Moving the session into an organization, for every surface that switches:
 * the dashboard's entry (`routes/dashboard/index.tsx`), the switching page
 * (`routes/dashboard/switching.tsx`) and the dashboard's sync of the session
 * to its address (`routes/dashboard/$id.tsx`).
 */

import { authClient } from '@/lib/auth-client';

import { authClientError } from './auth-client-error';

/**
 * How long a switch may take before the person is told it did not finish.
 * A fault's retries in the auth client take about 7.5 s (`lib/auth-client.ts`);
 * a late success still goes on into the organization.
 */
export const ORG_SWITCH_TIMEOUT_MS = 20_000;

/**
 * Make `organizationId` the session's active organization. Better Auth
 * answers a refusal (a rate limit, a membership that ended, a fault its
 * retries gave up on) instead of throwing it; this throws it, as the `Error`
 * `authClientError` builds, so a caller's `catch` sees every failure and
 * nothing goes on as if the session had switched: no audit entry, no way
 * into the organization. A request that gets no answer rejects as before.
 */
export async function setActiveOrganization(
  organizationId: string,
): Promise<void> {
  const result = await authClient.organization.setActive({ organizationId });
  if (result.error) throw authClientError(result.error);
}
