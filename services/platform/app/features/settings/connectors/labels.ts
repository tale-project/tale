/**
 * Localized display labels for the connectors domain's machine vocabularies
 * (auth methods, credential statuses) plus the per-connector endpoint copy.
 * The backend hands these out as plain strings, so each helper switches over
 * the known values with static translation keys and falls back to the raw
 * value for anything a future connector might add — the UI then still renders
 * something honest.
 */

import type { MaskedConnectorCredential } from './hooks/backend';

type Translator = (key: string, options?: Record<string, unknown>) => string;

/** What a credential's badge reads. */
type CredentialState = Pick<
  MaskedConnectorCredential,
  'status' | 'authMethod' | 'githubApp'
>;

export function authMethodLabel(t: Translator, method: string): string {
  switch (method) {
    case 'api-key':
      return t('connectors.authMethod.apiKey');
    case 'bearer':
      return t('connectors.authMethod.bearer');
    case 'basic':
      return t('connectors.authMethod.basic');
    case 'oauth2':
      return t('connectors.authMethod.oauth2');
    case 'client-credentials':
      return t('connectors.authMethod.clientCredentials');
    case 'github-app':
      return t('connectors.authMethod.githubApp');
    default:
      return method;
  }
}

/**
 * The badge label for a credential's state, or `null` for the healthy one
 * (an active credential needs no marker). `disabled` and `needs-reauth` stay
 * separate on purpose: the first is an operator's decision and is undone by
 * enabling the credential again, the second is the system reporting a grant
 * it could no longer refresh, which only re-consenting fixes. A GitHub App
 * has no grant to renew: its `needs-reauth` reports the app not installed —
 * not yet, a step of its setup, or no longer, as its installation was
 * removed on GitHub — and installing it is what fixes either.
 */
export function statusLabel(
  t: Translator,
  credential: CredentialState,
): string | null {
  switch (credential.status) {
    case 'disabled':
      return t('connectors.credential.disabled');
    case 'needs-reauth':
      if (credential.authMethod !== 'github-app') {
        return t('connectors.credential.needsReauth');
      }
      return isAwaitingInstall(credential)
        ? t('connectors.githubApp.statusNotInstalled')
        : t('connectors.githubApp.statusUninstalled');
    default:
      return null;
  }
}

/**
 * The badge's tone: attention where a human has to act on what broke — a
 * lost grant, an app's installation removed — and neutral for an operator's
 * decision or a GitHub App that is not installed yet.
 */
export function statusTone(credential: CredentialState): 'slate' | 'orange' {
  return credential.status === 'needs-reauth' && !isAwaitingInstall(credential)
    ? 'orange'
    : 'slate';
}

/** A GitHub App registered and never installed: no installation recorded. */
function isAwaitingInstall(credential: CredentialState): boolean {
  return (
    credential.authMethod === 'github-app' &&
    credential.githubApp?.installation === undefined
  );
}

/**
 * What the endpoint of a `per-credential` connector actually is, named for the
 * connector at hand — "endpoint URL" alone doesn't tell an admin whether to
 * paste a site, a store, or an API root.
 */
export function endpointHelp(t: Translator, connectorSlug: string): string {
  switch (connectorSlug) {
    case 'confluence':
      return t('connectors.dialog.endpointHelpConfluence');
    case 'shopify':
      return t('connectors.dialog.endpointHelpShopify');
    case 'forgejo':
      return t('connectors.dialog.endpointHelpForgejo');
    case 'glitchtip':
      return t('connectors.dialog.endpointHelpGlitchtip');
    default:
      return t('connectors.dialog.endpointHelpGeneric');
  }
}

/** Example origin for the endpoint field — a sample value, not UI copy, so it
 * reads the same in every language (the same call the providers page makes). */
export function endpointPlaceholder(connectorSlug: string): string {
  switch (connectorSlug) {
    case 'confluence':
      return 'https://your-site.atlassian.net';
    case 'shopify':
      return 'https://your-store.myshopify.com';
    case 'forgejo':
      return 'https://codeberg.org';
    case 'glitchtip':
      return 'https://app.glitchtip.com';
    default:
      return 'https://api.example.com';
  }
}
