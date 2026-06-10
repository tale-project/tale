/**
 * Shared response types and builders for sub-agent tools.
 */

export interface ToolUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationSeconds?: number;
}

export interface ToolResponse {
  success: boolean;
  response: string;
  error?: string;
  usage?: ToolUsage;
  model?: string;
  provider?: string;
  sources?: string[];
  input?: string;
  output?: string;
  /**
   * For a streamed delegation: the sub-thread the delegate ran on and the
   * stream its reasoning/tool deltas were written to. Surfaced in the parent's
   * `delegate_*` tool-result part so the UI can mount a nested, collapsible
   * timeline of the sub-agent's work. Absent for non-streamed delegations.
   */
  subThreadId?: string;
  subStreamId?: string;
}

export interface ToolResponseWithApproval extends ToolResponse {
  approvalCreated?: boolean;
  approvalId?: string;
}

export function errorResponse(error: string): ToolResponse {
  return { success: false, response: '', error };
}

export function successResponse(
  response: string,
  usage?: ToolUsage,
  model?: string,
  provider?: string,
  sources?: string[],
  input?: string,
  stream?: { subThreadId?: string; subStreamId?: string },
): ToolResponse {
  return {
    success: true,
    response,
    usage,
    model,
    provider,
    sources,
    input,
    output: response,
    subThreadId: stream?.subThreadId,
    subStreamId: stream?.subStreamId,
  };
}

export function handleToolError(
  toolName: string,
  error: unknown,
): ToolResponse {
  console.error(`[${toolName}] Error:`, {
    error,
    type: typeof error,
    isError: error instanceof Error,
    message: error instanceof Error ? error.message : undefined,
    name: error instanceof Error ? error.name : undefined,
  });

  const errorMessage = extractErrorMessage(error, toolName);
  return errorResponse(errorMessage);
}

function extractErrorMessage(error: unknown, toolName: string): string {
  if (error instanceof Error) {
    if (error.message && error.message.length > 0) {
      return error.message;
    }
    if (error.name && error.name !== 'Error') {
      return `${error.name} in ${toolName}`;
    }
    const cause = error.cause;
    if (cause instanceof Error && cause.message) {
      return cause.message;
    }
    // Empty Error from performAsyncSyscall typically means the sub-action
    // was killed by the Convex platform (e.g., 10-minute action timeout)
    if (error.stack?.includes('performAsyncSyscall')) {
      return `Sub-agent action timed out or was terminated by the platform in ${toolName}`;
    }
  }

  const str = String(error);
  if (str && str !== '[object Object]' && str !== 'undefined') {
    return str;
  }

  return `Unknown error in ${toolName}`;
}
