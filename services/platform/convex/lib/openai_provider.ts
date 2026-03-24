import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { getEnvOrThrow, getEnvOptional } from './get_or_throw';

/**
 * Shared OpenAI-compatible provider for Convex code.
 *
 * This is configured via environment variables so we can point at
 * OpenAI, OpenRouter, or any other OpenAI-compatible endpoint.
 *
 * Uses @ai-sdk/openai-compatible which natively extracts reasoning_content
 * from Chat Completions responses (needed for thinking models like Kimi 2.5,
 * DeepSeek R1, etc. via OpenRouter).
 *
 * - OPENAI_API_KEY: API key for the provider (required)
 * - OPENAI_BASE_URL: optional custom base URL (e.g. https://openrouter.ai/api/v1)
 *
 * The provider is lazily initialized on first access to ensure environment
 * variables are available (important for Convex startup sequence).
 */

type OpenAIProvider = ReturnType<typeof createOpenAICompatible>;

let _instance: OpenAIProvider | null = null;

function getProvider() {
  if (_instance === null) {
    const apiKey = getEnvOrThrow(
      'OPENAI_API_KEY',
      'API key for OpenAI provider',
    );
    const baseURL =
      getEnvOptional('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1';

    _instance = createOpenAICompatible({
      name: 'openai',
      baseURL,
      apiKey,
      supportsStructuredOutputs: true,
    });
  }
  return _instance;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Proxy target must match OpenAIProvider shape; actual calls are forwarded to the real lazily-initialized provider
const proxyTarget = Object.assign(
  function () {},
  {},
) as unknown as OpenAIProvider;

export const openai: OpenAIProvider = new Proxy(proxyTarget, {
  apply(_target, _thisArg, args) {
    const provider = getProvider();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- provider is callable (OpenAI-compatible factory); Function type required for .apply()
    return (provider as unknown as Function).apply(null, args);
  },
  get(_target, prop) {
    const provider = getProvider();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Proxy get trap receives string|symbol; narrow to known provider keys
    return provider[prop as keyof typeof provider];
  },
});
