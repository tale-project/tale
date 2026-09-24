/** The provider registry: every subscription this gateway can hold. */

import { createAnthropicProvider } from './anthropic';
import { createOpenAiProvider } from './openai';
import {
  PROVIDER_IDS,
  type FetchLike,
  type Provider,
  type ProviderId,
} from './types';

export interface ProviderRegistryOptions {
  anthropicClientId?: string;
  openAiClientId?: string;
  claudeCodeVersion?: string;
  fetchImpl?: FetchLike;
}

export type ProviderRegistry = Readonly<Record<ProviderId, Provider>>;

export function createProviderRegistry(
  options: ProviderRegistryOptions = {},
): ProviderRegistry {
  return Object.freeze({
    anthropic: createAnthropicProvider({
      clientId: options.anthropicClientId,
      claudeCodeVersion: options.claudeCodeVersion,
      fetchImpl: options.fetchImpl,
    }),
    openai: createOpenAiProvider({
      clientId: options.openAiClientId,
      fetchImpl: options.fetchImpl,
    }),
  });
}

/**
 * The catalog the panel renders as the "add an account" choice. How each
 * authorization comes back is decided per attempt — by where the browser
 * reaches the gateway — so the catalog names the providers and nothing more.
 */
export function describeProviders(
  registry: ProviderRegistry,
): { id: ProviderId }[] {
  return PROVIDER_IDS.filter((id) => id in registry).map((id) => ({ id }));
}

export type { Provider, ProviderId } from './types';
