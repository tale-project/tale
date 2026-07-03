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
 * Where a tool may be offered.
 *
 * - `'any'` — available to primary chat agents AND spawned sub-agent jobs.
 * - `'primary-only'` — structurally bound to the primary-turn interaction /
 *   resume model and must never be granted to a sub-agent job. The canonical
 *   example is `request_human_input`: answering its card resumes the PRIMARY
 *   agent, so a job holding it would strand an unanswerable question (jobs get
 *   the *capability* via their `needs_user_input` terminal state instead).
 *
 * REQUIRED (no default) on purpose: every new tool author makes this call
 * consciously, and the type system is the guard.
 */
export type ToolAvailability = 'any' | 'primary-only';

/**
 * Tool Definition
 *
 * Defines the structure of a tool in the LLM tools registry.
 */
export interface ToolDefinition {
  name: string; // unique tool identifier (e.g., 'customer_search')
  tool: ConvexAgentTool; // the actual createTool result
  availability: ToolAvailability; // see ToolAvailability — required by design
}
