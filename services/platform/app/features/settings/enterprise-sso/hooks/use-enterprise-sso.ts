import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * Data hooks for the unified Enterprise SSO + Provisioning settings card.
 * Reads the one connection per org and drives the OIDC/OAuth2/SAML config,
 * provisioning policy, and SCIM token from one place.
 */

export function useEnterpriseSso(organizationId: string) {
  return useConvexQuery(api.enterprise_sso.config.queries.get, {
    organizationId,
  });
}

export function useUpsertOidc() {
  return useConvexAction(api.enterprise_sso.config.actions.upsertOidc);
}

export function useUpsertSaml() {
  return useConvexAction(api.enterprise_sso.config.actions.upsertSaml);
}

export function useSetProvisioning() {
  return useConvexAction(api.enterprise_sso.config.actions.setProvisioning);
}

export function useTestSsoConnection() {
  return useConvexAction(api.enterprise_sso.config.actions.testConnection);
}

/** Parse IdP federation metadata (URL or uploaded XML) into the SAML fields. */
export function useParseSamlMetadata() {
  return useConvexAction(api.enterprise_sso.config.actions.parseIdpMetadata);
}

export function useRevealOidcClientId() {
  return useConvexAction(api.enterprise_sso.config.actions.revealOidcClientId);
}

export function useDisableSso() {
  return useConvexAction(api.enterprise_sso.config.actions.disableSso);
}

export function useRemoveSso() {
  return useConvexAction(api.enterprise_sso.config.actions.remove);
}

// SCIM token management (mutations on the SCIM token row).
export function useRegenerateScimToken() {
  return useConvexMutation(api.scim.mutations.regenerateToken);
}

export function useDisableScim() {
  return useConvexMutation(api.scim.mutations.disable);
}
