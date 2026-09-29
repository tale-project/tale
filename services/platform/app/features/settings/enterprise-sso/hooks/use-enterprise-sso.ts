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

// The form reports a failure of the writes below that opt out itself: a
// save through its Save cluster (a missing secret under its input), a
// connection test, a metadata import or a SCIM token in its own toast. The
// default toast would report it a second time.

export function useUpsertOidc() {
  return useBackendAction('enterprise_sso/config/actions:upsertOidc', {
    errorToast: false,
  });
}

export function useUpsertSaml() {
  return useBackendAction('enterprise_sso/config/actions:upsertSaml', {
    errorToast: false,
  });
}

export function useTestSsoConnection() {
  return useBackendAction('enterprise_sso/config/actions:testConnection', {
    errorToast: false,
  });
}

/** Parse IdP federation metadata (URL or uploaded XML) into the SAML fields. */
export function useParseSamlMetadata() {
  return useBackendAction('enterprise_sso/config/actions:parseIdpMetadata', {
    errorToast: false,
  });
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
  return useBackendMutation('scim/mutations:regenerateToken', {
    errorToast: false,
  });
}

export function useDisableScim() {
  return useBackendMutation('scim/mutations:disable');
}
