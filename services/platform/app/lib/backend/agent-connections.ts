import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { BackendApiError, backendFetch } from './api-client';
import { backendKey } from './query-keys';

/**
 * What the consent page of a coding agent is told before it shows its choices
 * (`GET /api/app/agent-connections/consent-context`): who the app is, what it
 * asked for, and where the signed-in person may connect it. Read at the
 * boundary: the page offers only what an answer of this shape allows.
 *
 * The answer is about the person, not about an organization, so its key is
 * the account's (`me`), as the other account reads are.
 */
const ACCOUNT_SCOPE = 'me';

const organizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  allowed: z.boolean(),
  reason: z.enum(['ORG_FORBIDDEN', 'AGENT_CONNECT_FORBIDDEN']).optional(),
  ceiling: z.array(z.string()),
  previous: z.array(z.string()).nullable(),
});

export const agentConsentContextSchema = z.object({
  client: z.object({
    id: z.string(),
    name: z.string(),
    provenance: z.enum(['metadata_document', 'registered']),
    host: z.string().nullable(),
  }),
  requestedScopes: z.array(z.string()),
  eligible: z.boolean(),
  activeOrganizationId: z.string().nullable(),
  organizations: z.array(organizationSchema),
});

export type AgentConsentContext = z.infer<typeof agentConsentContextSchema>;
export type AgentConsentOrganization =
  AgentConsentContext['organizations'][number];

/** An answer is deterministic unless the server or the network failed: only
 * a failure of that kind is worth asking for again. */
export function isRetryableFailure(error: unknown): boolean {
  return !(error instanceof BackendApiError && error.status < 500);
}

function retryTransportOnly(failureCount: number, error: unknown): boolean {
  return isRetryableFailure(error) && failureCount < 2;
}

export function agentConsentContextQuery(args: {
  clientId: string;
  scope: string;
}) {
  return queryOptions({
    queryKey: backendKey(
      ACCOUNT_SCOPE,
      'agent-connections',
      'consent-context',
      args.clientId,
      args.scope,
    ),
    queryFn: async ({ signal }) =>
      agentConsentContextSchema.parse(
        await backendFetch<unknown>(
          `/agent-connections/consent-context?${new URLSearchParams({
            client_id: args.clientId,
            scope: args.scope,
          })}`,
          { signal },
        ),
      ),
    retry: retryTransportOnly,
    // The answer names what the person may do right now: read it every time
    // the page opens.
    staleTime: 0,
    gcTime: 0,
  });
}
