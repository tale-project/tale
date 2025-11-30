/**
 * message-helpers - Utilities for processing and formatting chat messages
 */

/**
 * Strip workflow context that was appended to user messages by the assistant agent.
 *
 * The workflow context follows this pattern:
 * - Starts with "\n\n**Current Workflow Context:**"
 * - Contains workflow metadata and step details in toon format
 * - Ends with a closing code fence "```"
 *
 * @param content - The message content potentially containing workflow context
 * @returns The cleaned message content without workflow context
 *
 * @example
 * const userMessage = "Hello\n\n**Current Workflow Context:**\n...";
 * const clean = stripWorkflowContext(userMessage);
 * // Returns: "Hello"
 */
export function stripWorkflowContext(content: string): string {
  // Define the marker that indicates the start of workflow context
  const contextMarker = '\n\n**Current Workflow Context:**';

  // Find where the workflow context starts
  const contextStart = content.indexOf(contextMarker);

  // If no context marker found, return original content
  if (contextStart === -1) {
    return content;
  }

  // Verify it's actually workflow context by checking for the pattern
  const afterMarker = content.substring(contextStart);
  const hasWorkflowId = afterMarker.includes('- **Workflow ID:**');
  const hasStepDetails = afterMarker.includes(
    '**Step Details (Toon Format):**',
  );

  // Only strip if it looks like actual workflow context
  if (hasWorkflowId && hasStepDetails) {
    return content.substring(0, contextStart).trim();
  }

  // If pattern doesn't match, return original content
  return content;
}

/**
 * Extract workflow context from a message if it exists.
 * Useful if you want to show it separately (e.g., in a collapse component).
 *
 * @param content - The message content potentially containing workflow context
 * @returns The workflow context or null if not found
 *
 * @example
 * const userMessage = "Hello\n\n**Current Workflow Context:**\n...";
 * const context = extractWorkflowContext(userMessage);
 * // Returns: "**Current Workflow Context:**\n..."
 */
export function extractWorkflowContext(content: string): string | null {
  const contextMarker = '\n\n**Current Workflow Context:**';
  const contextStart = content.indexOf(contextMarker);

  if (contextStart === -1) {
    return null;
  }

  // Verify it's actually workflow context by checking for the pattern
  const afterMarker = content.substring(contextStart);
  const hasWorkflowId = afterMarker.includes('- **Workflow ID:**');
  const hasStepDetails = afterMarker.includes(
    '**Step Details (Toon Format):**',
  );

  // Only extract if it looks like actual workflow context
  if (hasWorkflowId && hasStepDetails) {
    // Extract from marker onwards (skip the leading \n\n)
    return content.substring(contextStart + 2).trim();
  }

  return null;
}
