/**
 * Per-request HTTP headers attached at provider construction.
 *
 * Pure + dependency-free of the AI SDK so it can be unit-tested without loading
 * it (resolve_model.ts is a `'use node'` action module). OpenRouter surfaces
 * `HTTP-Referer` + `X-Title` on its activity and public app-rankings pages, so
 * sending them attributes our traffic to Tale. Keyed off the provider name /
 * base host, so direct providers (OpenAI, Anthropic, …) that don't use these
 * headers are left untouched.
 */

import type { ReasoningCapabilityConfig } from '../../lib/shared/schemas/providers';
import { resolveReasoningCapability } from '../lib/agent_response/reasoning/capability';

/** Public app identity sent to gateways that attribute traffic to an app. */
export const TALE_APP_URL = 'https://tale.dev';
export const TALE_APP_NAME = 'Tale';

/**
 * The Anthropic beta that lets extended-thinking blocks INTERLEAVE with tool
 * calls across a multi-step turn (think → call tool → think again → answer)
 * instead of front-loading all thinking before the first tool call. Anthropic
 * forwards it through OpenRouter for Anthropic-routed models.
 */
const INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14';

interface InterleavedThinkingInput {
  modelId: string;
  /** Resolved reasoning capability (operator JSON + catalog cache). */
  reasoning?: ReasoningCapabilityConfig;
}

/**
 * Enable interleaved thinking for Anthropic-style extended-thinking models
 * (`knob: 'budgetTokens'`). Gated strictly on the budget-token knob so the beta
 * header never reaches an effort-knob or non-reasoning endpoint that would
 * reject an unknown beta. The governor's `thinking` overlay supplies the budget;
 * this header is what makes that thinking interleave across tool steps.
 */
export function interleavedThinkingHeaders(
  input: InterleavedThinkingInput,
): Record<string, string> {
  const capability = resolveReasoningCapability(input);
  if (capability?.knob === 'budgetTokens') {
    return { 'anthropic-beta': INTERLEAVED_THINKING_BETA };
  }
  return {};
}

interface ProviderAttributionInput {
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
  } catch {
    return false;
  }
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
}

export function providerAttributionHeaders(
  input: ProviderAttributionInput,
): Record<string, string> {
  if (isOpenRouter(input)) {
    return { 'HTTP-Referer': TALE_APP_URL, 'X-Title': TALE_APP_NAME };
  }
  return {};
}
