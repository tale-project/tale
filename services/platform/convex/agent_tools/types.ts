/**
 * LLM Tools Type Definitions
 */

// =============================================================================
// TOOL DEFINITION TYPES
// =============================================================================

// Convex Agent tool type (from @convex-dev/agent)
// Represents a tool created with createTool() from Convex Agent SDK
// Using unknown since the actual Tool type structure is complex and dynamic
type ConvexAgentTool = unknown;

/**
 * Tool Definition
 *
 * Defines the structure of a tool in the LLM tools registry.
 */
export interface ToolDefinition {
  name: string; // unique tool identifier (e.g., 'customer_search')
  tool: ConvexAgentTool; // the actual createTool result
}

// =============================================================================
// MCP SERVER TYPES
// =============================================================================

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  serverId: string;
  name: string;
  url: string;
  sessionId?: string;
  authConfig?: {
    headers?: Record<string, string>;
    credentials?: Record<string, string>;
  };
  enabled: boolean;
}

/**
 * Central catalog entry for an MCP server (extends config)
 * Optional fields are kept for potential filtering/metadata.
 */
export interface MCPServerRegistration extends MCPServerConfig {
  toolAllowlist?: string[];
  toolBlocklist?: string[];
  categories?: Record<string, string>;
}
