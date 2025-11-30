/**
 * MCP Server Catalog (no auto-registration)
 *
 * Define all known MCP servers here. Servers are NOT registered globally
 * at load time; instead, LLM nodes reference them by ID on-demand and the
 * executor resolves the definitions (with variable substitution) when used.
 */

import type { MCPServerRegistration } from '../types';

// Catalog of known MCP servers. Add entries here; do not register globally.
export const MCP_SERVER_CATALOG: MCPServerRegistration[] = [
  // Shopify Storefront MCP server (uses workflow variables for domain)
  {
    serverId: 'shopify-storefront',
    name: 'Shopify Storefront MCP',
    url: 'https://{{shopifyDomain}}/api/mcp',
    enabled: true,
  },
];
