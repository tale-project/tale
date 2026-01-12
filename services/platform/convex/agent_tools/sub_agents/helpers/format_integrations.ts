/**
 * Format integrations list for sub-agent context
 *
 * Provides a minimal format for integration information.
 * Only includes integration name and type - operations are fetched
 * on-demand via integration_introspect tool to reduce context size.
 */

import type { Doc } from '../../../_generated/dataModel';

type Integration = Doc<'integrations'>;

/**
 * Format a list of integrations into a minimal string for LLM context.
 * Only includes integration name, type, and status.
 * Operations should be retrieved via integration_introspect tool.
 */
export function formatIntegrationsForContext(integrations: Integration[]): string {
  if (!integrations || integrations.length === 0) {
    return '';
  }

  return integrations
    .map((integration) => {
      const type = integration.type || 'rest_api';
      const status = integration.status || 'active';
      return `• ${integration.name} (${type}, ${status})`;
    })
    .join('\n');
}
