// Session env helpers for external-agent credential injection.

import { getCredentialEnvKeys } from './credential-policy';
import type { ProductAgentSlug } from './events';
import { PRODUCT_AGENT_SLUGS } from './events';

/** Platform-managed Anthropic gateway keys that may linger in session env. */
const ANTHROPIC_GATEWAY_SESSION_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'TALE_GATEWAY_TOKEN',
] as const;

/** Keys to unset before a turn so a prior runtime's credentials do not win. */
export function collectScrubCredentialEnvKeys(
  slug: ProductAgentSlug,
  gatewayRun: boolean,
  byo: boolean,
): string[] {
  const keys = new Set<string>();
  for (const s of PRODUCT_AGENT_SLUGS) {
    if (s === slug) continue;
    for (const k of getCredentialEnvKeys(s)) keys.add(k);
  }
  if (!gatewayRun || byo) {
    for (const k of ANTHROPIC_GATEWAY_SESSION_KEYS) keys.add(k);
  }
  return [...keys];
}

/** Env-managed managed runs: org agent-env keys must not be overridden by user env. */
export function filterUserEnvForManagedAgentEnv(
  userEnv: Record<string, string>,
  protectedKeys: readonly string[],
): Record<string, string> {
  const blocked = new Set(protectedKeys);
  return Object.fromEntries(
    Object.entries(userEnv).filter(([k]) => !blocked.has(k)),
  );
}
