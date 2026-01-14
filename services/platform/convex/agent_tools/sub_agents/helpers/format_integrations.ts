/**
 * Format integrations list for sub-agent context
 *
 * Provides domain-aware format for integration information.
 * Includes title and description to help AI understand what domain
 * each integration covers (e.g., hotel PMS, e-commerce, etc.).
 * Operations are fetched on-demand via integration_introspect tool.
 */

import type { Doc } from '../../../_generated/dataModel';

type Integration = Doc<'integrations'>;

/**
 * Format a list of integrations into a domain-aware string for LLM context.
 * Includes integration name, type, status, title, and description.
 * This helps the AI understand which integration to use for domain-specific queries.
 * Operations should be retrieved via integration_introspect tool.
 */
export function formatIntegrationsForContext(integrations: Integration[]): string {
  if (!integrations || integrations.length === 0) {
    return 'No integrations are currently configured for this organization.';
  }

  return integrations
    .map((integration) => {
      const type = integration.type || 'rest_api';
      const status = integration.status || 'active';

      // Include title and description for domain context
      const title = integration.title || integration.name;
      const description = integration.description ? ` - ${integration.description}` : '';

      return `• ${integration.name} (${type}, ${status}): ${title}${description}`;
    })
    .join('\n');
}
