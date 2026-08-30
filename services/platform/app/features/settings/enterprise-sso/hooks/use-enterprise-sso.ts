import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';

/**
 * Data hooks for the unified Enterprise SSO + Provisioning settings card.
 * Reads the one connection per org and drives the OIDC/OAuth2/SAML config,
 * provisioning policy, and SCIM token from one place.
 */

export function useEnterpriseSso(organizationId: string) {
  return useConvexQuery('enterprise_sso/config/queries:get', {
    organizationId,
  });
}

export function useUpsertOidc() {
  return useConvexAction('enterprise_sso/config/actions:upsertOidc');
}

export function useUpsertSaml() {
  return useConvexAction('enterprise_sso/config/actions:upsertSaml');
}

export function useSetProvisioning() {
  return useConvexAction('enterprise_sso/config/actions:setProvisioning');
}

export function useTestSsoConnection() {
  return useConvexAction('enterprise_sso/config/actions:testConnection');
}

/** Parse IdP federation metadata (URL or uploaded XML) into the SAML fields. */
export function useParseSamlMetadata() {
  return useConvexAction('enterprise_sso/config/actions:parseIdpMetadata');
}

export function useRevealOidcClientId() {
  return useConvexAction('enterprise_sso/config/actions:revealOidcClientId');
}

export function useDisableSso() {
  return useConvexAction('enterprise_sso/config/actions:disableSso');
}

export function useRemoveSso() {
  return useConvexAction('enterprise_sso/config/actions:remove');
}

// SCIM token management (mutations on the SCIM token row).
export function useRegenerateScimToken() {
  return useConvexMutation('scim/mutations:regenerateToken');
}

export function useDisableScim() {
  return useConvexMutation('scim/mutations:disable');
}
