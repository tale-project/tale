import {
  OPENROUTER_BASE_URL,
  OPENROUTER_PROVIDER_NAME,
} from '@/lib/shared/constants/openrouter-recommended';

/**
 * Known-provider presets for the add flow (#2655) and the base-URL lock in the
 * edit panel (#2653). These are the providers the add panel's own guidance
 * copy names; their endpoints are fixed, published facts — asking users to
 * type them invites typos.
 *
 * All three names are standard gateway providers (`isStandardGatewayProvider`)
 * whose wire format the gateway already knows, so presets never set
 * `apiFormat` (the backend rejects it on these slugs). The OpenRouter entry
 * mirrors `builtin-configs/providers/openrouter.json` via the shared constant.
 */
export interface KnownProvider {
  /** The fixed provider slug (also the gateway's native provider name). */
  name: string;
  displayName: string;
  baseUrl: string;
}

export const KNOWN_PROVIDERS: readonly KnownProvider[] = [
  {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    name: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    name: OPENROUTER_PROVIDER_NAME,
    displayName: 'OpenRouter',
    baseUrl: OPENROUTER_BASE_URL,
  },
];

/** The catalog endpoint for a provider slug, when it is a known provider. */
export function knownProviderBaseUrl(name: string): string | undefined {
  return KNOWN_PROVIDERS.find((p) => p.name === name)?.baseUrl;
}
