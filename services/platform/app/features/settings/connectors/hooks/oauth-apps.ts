import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useBackendQuery } from '@/app/hooks/use-backend-query';

/**
 * The org-level OAuth app registry (Settings > Connectors). The upsert is an
 * ACTION — it carries the plaintext client secret to the server-side
 * encryption layer, like credential writes — and never reads a secret back;
 * the list serves masked previews only.
 */

/** Every org-configured OAuth app, masked. */
export function useConnectorOauthApps(organizationId: string) {
  return useBackendQuery('connector_oauth_apps/queries:list', {
    organizationId,
  });
}

/** The Knowledge OneDrive import lane's app state — it has no catalog row,
 * so the settings card asks the cloud-import probe for its env half. */
export function useOnedriveImportAppStatus(organizationId: string) {
  return useBackendQuery('cloud_import/queries:getOauthAppStatus', {
    organizationId,
    provider: 'onedrive',
  });
}

/** Whether Enterprise SSO carries an Entra ID registration the Microsoft
 * 365 import app could reuse — admin-gated, like the card that asks. */
export function useEntraSsoSource(organizationId: string) {
  return useBackendQuery('connector_oauth_apps/queries:entraSsoSource', {
    organizationId,
  });
}

/** Create or replace the org's app for one connector slug. */
export function useUpsertConnectorOauthApp() {
  return useBackendAction('connector_oauth_apps/actions:upsert');
}

/** Copy the Enterprise SSO Entra registration into the org's app — the
 * secret moves server-side and never enters the browser. */
export function useReuseSsoOauthApp() {
  return useBackendAction('connector_oauth_apps/actions:reuseSso');
}

/** Drop the org's app — resolution falls back to the deployment env. */
export function useRemoveConnectorOauthApp() {
  return useBackendMutation('connector_oauth_apps/mutations:remove', {
    errorToast: false,
  });
}
