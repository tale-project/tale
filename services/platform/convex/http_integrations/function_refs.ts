/**
 * Typed references to this domain's own internal functions.
 *
 * The HTTP handlers run in V8 and reach the filesystem-bound catalog reader and
 * the transactional state mutations through the function boundary, so they need
 * references to call. They are built by name (the `trusted_headers_auth`
 * pattern) rather than through the generated `internal` tree, which keeps the
 * routes compiling and testable without a running backend to codegen against —
 * the generics below carry the same argument and return types the callees
 * declare, so a drifting signature still fails the typecheck at the call site.
 */

import { makeFunctionReference } from 'convex/server';

/** Argument records must be object-literal type aliases — see credential_seam. */
type StateHashArgs = { stateHash: string };

type CreatePendingArgs = {
  stateHash: string;
  organizationId: string;
  userId: string;
  connectorSlug: string;
  codeVerifier: string;
  redirectUri: string;
};

export type ConsumePendingResult =
  | {
      ok: true;
      organizationId: string;
      userId: string;
      connectorSlug: string;
      codeVerifier: string;
      redirectUri: string;
    }
  | { ok: false; reason: 'unknown' | 'expired' };

export const createPendingAuthorizationRef = makeFunctionReference<
  'mutation',
  CreatePendingArgs,
  null
>('http_integrations/oauth_state_mutations:createPendingAuthorization');

export const consumePendingAuthorizationRef = makeFunctionReference<
  'mutation',
  StateHashArgs,
  ConsumePendingResult
>('http_integrations/oauth_state_mutations:consumePendingAuthorization');

export type ConnectorOauth2Endpoints = {
  displayName: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
};

export const getOauth2EndpointsRef = makeFunctionReference<
  'action',
  { connectorSlug: string },
  ConnectorOauth2Endpoints | null
>('http_integrations/connector_catalog:getOauth2Endpoints');

export type SlackTeamRoute = { organizationId: string; credentialId: string };

export const resolveTeamRouteRef = makeFunctionReference<
  'query',
  { teamId: string },
  SlackTeamRoute | null
>('http_integrations/slack_routing:resolveTeamRoute');

export const claimTeamRouteRef = makeFunctionReference<
  'mutation',
  { teamId: string; organizationId: string; credentialId: string },
  { ok: true } | { ok: false; reason: 'claimed_by_other_org' }
>('http_integrations/slack_routing:claimTeamRoute');

export const deliverInboundEventRef = makeFunctionReference<
  'action',
  {
    organizationId: string;
    credentialId: string;
    teamId: string;
    eventId?: string;
    eventType?: string;
    event: unknown;
  },
  null
>('http_integrations/slack_routing:deliverInboundEvent');
