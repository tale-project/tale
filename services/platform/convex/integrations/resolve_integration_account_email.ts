import type { LoadedIntegration } from './load_integration';

/**
 * Best-effort account address for classifying synced mail direction.
 * Prefers the integration's configured From address, then the mailbox login.
 */
export function accountEmailFromIntegration(
  integration: LoadedIntegration,
): string | undefined {
  const config =
    integration.connectionConfig &&
    typeof integration.connectionConfig === 'object' &&
    !Array.isArray(integration.connectionConfig)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- connectionConfig is v.any() with catchall keys
        (integration.connectionConfig as Record<string, unknown>)
      : undefined;

  const fromAddress =
    typeof config?.fromAddress === 'string' ? config.fromAddress.trim() : '';
  if (fromAddress) {
    return fromAddress;
  }

  const username = integration.basicAuth?.username?.trim();
  if (username?.includes('@')) {
    return username;
  }

  return undefined;
}
