import type { Integration, IntegrationType } from '../types';

/**
 * Gets the integration type, defaulting to 'rest_api' for backward compatibility.
 * Use this instead of directly accessing integration.type to handle legacy integrations.
 */
export function getIntegrationType(integration: Integration): IntegrationType {
  return integration.type ?? 'rest_api';
}
