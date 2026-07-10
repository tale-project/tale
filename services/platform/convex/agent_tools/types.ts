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
  name: string; // unique tool identifier (e.g., 'contact_read')
  tool: ConvexAgentTool; // the actual createTool result
  availability: ToolAvailability; // see ToolAvailability — required by design
  /**
   * Callable from an external agent's sandbox over the workspace-tool bridge
   * (`POST /api/tools/execute`). Orthogonal to `availability` (which seats a
   * tool between primary turns and sub-agent jobs): bridgeable means pure
   * request/response against platform data — no dependency on the platform
   * loop's suspension/resume or interactive continuation, and safe under the
   * dispatch-synthesized ToolCtx (organizationId + threadId + userId, no live
   * generation). Keep in lockstep with EXTERNAL_AGENT_TOOL_NAMES in
   * lib/shared/schemas/agents.ts — `sandbox_bridge.test.ts` fails on drift.
   */
  sandboxBridge?: true;
}
