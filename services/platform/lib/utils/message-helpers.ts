/**
 * message-helpers - Utilities for processing and formatting chat messages
 */

const IMAGES_MARKER_RE =
  /\n\n\[IMAGES\] The user has (attached|also attached) the following images:[\s\S]*$/;
const ATTACHMENTS_MARKER_RE =
  /\n\n\[ATTACHMENTS\] The user has attached the following files\. Use the appropriate tool to read them:[\s\S]*$/;

/**
 * Strip internal prompt markers from user messages.
 * These markers are added for the AI but should not be displayed to users.
 */
function stripInternalMarkers(content: string): string {
  content = content.replace(IMAGES_MARKER_RE, '');
  content = content.replace(ATTACHMENTS_MARKER_RE, '');

  return content.trim();
}

/**
 * Strip workflow context that was appended to user messages by the assistant agent.
 *
 * The workflow context follows this pattern:
 * - Starts with "\n\n**Current Workflow Context:**"
 * - Contains workflow metadata and step details in toon format
 * - Ends with a closing code fence "```"
 *
 * Also strips internal prompt markers like [IMAGES] and [ATTACHMENTS] that are
 * meant for the AI model but should not be displayed to users.
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
  // First strip internal markers ([IMAGES], [ATTACHMENTS])
  content = stripInternalMarkers(content);

  // Define the marker that indicates the start of workflow context
  const contextMarker = '\n\n**Current Workflow Context:**';

  // Find where the workflow context starts
  const contextStart = content.indexOf(contextMarker);

  // If no context marker found, return the content (already cleaned of internal markers)
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

  // If pattern doesn't match, return content (already cleaned of internal markers)
  return content;
}
