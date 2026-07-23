/**
 * App-attribution HTTP headers for upstream AI providers.
 *
 * OpenRouter surfaces `HTTP-Referer` + `X-Title` on its activity and public
 * app-rankings pages, so sending them attributes the platform's traffic to
 * Tale instead of "Unknown". Keyed off the provider name / base host; direct
 * providers (OpenAI, Anthropic, …) don't read these headers and are left
 * untouched. Pure so both the in-platform chat path and the sandbox
 * LLM-gateway provisioner attach the exact same identity.
 */

/** Public app identity sent to gateways that attribute traffic to an app. */
export const TALE_APP_URL = 'https://tale.dev';
export const TALE_APP_NAME = 'Tale';

export interface ProviderAttributionInput {
  providerName: string;
  baseUrl: string;
}

function isOpenRouter({
  providerName,
  baseUrl,
}: ProviderAttributionInput): boolean {
  if (providerName.toLowerCase() === 'openrouter') return true;
  let host = '';
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch (err) {
    console.warn(
      `[attribution] unparseable provider base URL "${baseUrl}":`,
      err,
    );
    return false;
  }
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
}

/** Attribution headers for one provider; empty for providers that have no
 * attribution surface. */
export function providerAttributionHeaders(
  input: ProviderAttributionInput,
): Record<string, string> {
  if (isOpenRouter(input)) {
    return { 'HTTP-Referer': TALE_APP_URL, 'X-Title': TALE_APP_NAME };
  }
  return {};
}
