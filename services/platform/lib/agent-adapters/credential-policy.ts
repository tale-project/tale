// Credential backend + runtime capabilities helpers.

import type { ProductAgentSlug } from './events';
import { getAgentAdapter } from './registry';
import type { AgentCapabilities, CredentialPolicy } from './types';

export function getCredentialPolicy(slug: ProductAgentSlug): CredentialPolicy {
  return getAgentAdapter(slug).credentialPolicy;
}

export function getAgentCapabilities(
  slug: ProductAgentSlug,
): AgentCapabilities {
  return getAgentAdapter(slug).capabilities;
}

/** Gateway VK mint + provider provisioning apply only when true. */
export function usesGateway(
  slug: ProductAgentSlug,
  authMode: 'managed' | 'byo' | undefined,
): boolean {
  const byo = authMode === 'byo';
  if (byo) return false;
  return getCredentialPolicy(slug).managedSource === 'gateway';
}

export function getCredentialEnvKeys(
  slug: ProductAgentSlug,
): readonly string[] {
  return getAgentAdapter(slug).credentialEnvKeys;
}
