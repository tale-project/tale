/**
 * Localized display labels for the connectors domain's machine vocabularies
 * (auth methods, credential statuses) plus the per-connector endpoint copy.
 * The backend hands these out as plain strings, so each helper switches over
 * the known values with static translation keys and falls back to the raw
 * value for anything a future connector might add — the UI then still renders
 * something honest.
 */

import type { StorableAuthMethodName } from '@/lib/shared/schemas/connectors';

type Translator = (key: string, options?: Record<string, unknown>) => string;

const AUTH_METHODS = new Set<string>(['api-key', 'bearer', 'basic', 'oauth2']);

/** Narrows a picker's raw string back to the STORABLE connector vocabulary
 * (`platform` never reaches a picker), so a value from outside it is ignored
 * instead of asserted into the union. */
export function isAuthMethod(value: string): value is StorableAuthMethodName {
  return AUTH_METHODS.has(value);
}

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
    default:
      return method;
  }
}

/**
 * The badge label for a credential's state, or `null` for the healthy one
 * (an active credential needs no marker). `disabled` and `needs-reauth` stay
 * separate on purpose: the first is an operator's decision and is undone by
 * enabling the credential again, the second is the system reporting a grant
 * it could no longer refresh, which only re-consenting fixes.
 */
export function statusLabel(t: Translator, status: string): string | null {
  switch (status) {
    case 'disabled':
      return t('connectors.credential.disabled');
    case 'needs-reauth':
      return t('connectors.credential.needsReauth');
    default:
      return null;
  }
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
    default:
      return 'https://api.example.com';
  }
}
