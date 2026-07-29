/**
 * Localized display labels for the provider domain's machine vocabularies
 * (credential auth methods, catalog sources, wire formats). The backend hands
 * these out as plain strings, so each helper switches over the known values
 * with static translation keys and falls back to the raw value for anything
 * a future provider might add — the UI then still renders something honest.
 */

type Translator = (key: string, options?: Record<string, unknown>) => string;

export const KNOWN_AUTH_METHODS = [
  'api-key',
  'env',
  'subscription-key',
  'subscription-broker',
] as const;
export type KnownAuthMethod = (typeof KNOWN_AUTH_METHODS)[number];

export function isKnownAuthMethod(value: string): value is KnownAuthMethod {
  return (KNOWN_AUTH_METHODS as readonly string[]).includes(value);
}

export function authMethodLabel(t: Translator, method: string): string {
  switch (method) {
    case 'api-key':
      return t('providers.authMethod.apiKey');
    case 'env':
      return t('providers.authMethod.env');
    case 'subscription-key':
      return t('providers.authMethod.subscriptionKey');
    case 'subscription-broker':
      return t('providers.authMethod.subscriptionBroker');
    default:
      return method;
  }
}

export function catalogSourceLabel(t: Translator, source: string): string {
  switch (source) {
    case 'static':
      return t('providers.card.sourceStatic');
    case 'openrouter-api':
      return t('providers.card.sourceOpenrouterApi');
    case 'models-endpoint':
      return t('providers.card.sourceModelsEndpoint');
    case 'none':
      return t('providers.card.sourceNone');
    default:
      return source;
  }
}

export function apiFormatLabel(t: Translator, format: string): string {
  switch (format) {
    case 'openai':
      return t('providers.apiFormat.openai');
    case 'anthropic':
      return t('providers.apiFormat.anthropic');
    default:
      return format;
  }
}
