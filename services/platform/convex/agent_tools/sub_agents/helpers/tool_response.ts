/**
 * Shared response types and builders for sub-agent tools.
 */

import type { SandboxState } from '../../files/helpers/sandbox_state';

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
   * The sub-agent's own thread (a spawned job's transcript thread; formerly a
   * delegate's sub-thread) and, when live-streamed, the stream its deltas were
   * written to. Surfaced in the parent's tool-result part so the UI can mount
   * a nested, collapsible timeline of the sub-agent's work.
   */
  subThreadId?: string;
  subStreamId?: string;
  /** The `agentJobs` row backing a `spawn_agent` run (job card anchor). */
  jobId?: string;
  /** Human-readable note of capabilities narrowed away at spawn time. */
  narrowed?: string;
  /**
   * The shared thread workspace after a job that was granted workspace
   * tools ran (success OR failure) — the parent sees exactly which files
   * the worker produced instead of recreating them from its text reply.
   */
  sandboxState?: SandboxState;
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
