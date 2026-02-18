import { createOpenAI } from '@ai-sdk/openai';

import { getEnvOrThrow, getEnvOptional } from './get_or_throw';

/**
 * Shared OpenAI-compatible provider for Convex code.
 *
 * This is configured via environment variables so we can point at
 * OpenAI, OpenRouter, or any other OpenAI-compatible endpoint.
 *
 * - OPENAI_API_KEY: API key for the provider (required)
 * - OPENAI_BASE_URL: optional custom base URL (e.g. https://openrouter.ai/api/v1)
 *
 * The provider is lazily initialized on first access to ensure environment
 * variables are available (important for Convex startup sequence).
 */

let _openaiInstance: ReturnType<typeof createOpenAI> | null = null;

function getOpenAIProvider() {
  if (_openaiInstance === null) {
    const apiKey = getEnvOrThrow(
      'OPENAI_API_KEY',
      'API key for OpenAI provider',
    );
    const baseURL = getEnvOptional('OPENAI_BASE_URL');

    _openaiInstance = createOpenAI({
      apiKey,
      baseURL,
    });
  }
  return _openaiInstance;
}

type OpenAIProvider = ReturnType<typeof createOpenAI>;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Proxy target must match OpenAIProvider shape; actual calls are forwarded to the real lazily-initialized provider
const proxyTarget = Object.assign(
  function () {},
  {},
) as unknown as OpenAIProvider;

export const openai: OpenAIProvider = new Proxy(proxyTarget, {
  apply(_target, _thisArg, args) {
    const provider = getOpenAIProvider();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- provider is callable (OpenAI factory); Function type required for .apply()
    return (provider as unknown as Function).apply(null, args);
  },
  get(_target, prop) {
    const provider = getOpenAIProvider();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Proxy get trap receives string|symbol; narrow to known provider keys
    return provider[prop as keyof typeof provider];
  },
});
