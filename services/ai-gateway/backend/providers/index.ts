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

/** The catalog the panel renders as the "add an account" choice. */
export function describeProviders(
  registry: ProviderRegistry,
): { id: ProviderId; callbackStyle: Provider['callbackStyle'] }[] {
  return PROVIDER_IDS.map((id) => ({
    id,
    callbackStyle: registry[id].callbackStyle,
  }));
}

export type { Provider, ProviderId } from './types';
