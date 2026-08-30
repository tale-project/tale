import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useBackendQuery } from '@/app/hooks/use-backend-query';

/**
 * Data hooks for the unified Enterprise SSO + Provisioning settings card.
 * Reads the one connection per org and drives the OIDC/OAuth2/SAML config,
 * provisioning policy, and SCIM token from one place.
 */

export function useEnterpriseSso(organizationId: string) {
  return useBackendQuery('enterprise_sso/config/queries:get', {
    organizationId,
  });
}

export function useUpsertOidc() {
  return useBackendAction('enterprise_sso/config/actions:upsertOidc');
}

export function useUpsertSaml() {
  return useBackendAction('enterprise_sso/config/actions:upsertSaml');
}

export function useSetProvisioning() {
  return useBackendAction('enterprise_sso/config/actions:setProvisioning');
}

export function useTestSsoConnection() {
  return useBackendAction('enterprise_sso/config/actions:testConnection');
}

/** Parse IdP federation metadata (URL or uploaded XML) into the SAML fields. */
export function useParseSamlMetadata() {
  return useBackendAction('enterprise_sso/config/actions:parseIdpMetadata');
}

export function useRevealOidcClientId() {
  return useBackendAction('enterprise_sso/config/actions:revealOidcClientId');
}

export function useDisableSso() {
  return useBackendAction('enterprise_sso/config/actions:disableSso');
}

export function useRemoveSso() {
  return useBackendAction('enterprise_sso/config/actions:remove');
}

// SCIM token management (mutations on the SCIM token row).
export function useRegenerateScimToken() {
  return useBackendMutation('scim/mutations:regenerateToken');
}

export function useDisableScim() {
  return useBackendMutation('scim/mutations:disable');
}
