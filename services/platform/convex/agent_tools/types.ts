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
