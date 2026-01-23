/**
 * Shared response types and builders for sub-agent tools.
 */

export interface ToolUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ToolResponse {
  success: boolean;
  response: string;
  error?: string;
  usage?: ToolUsage;
}

export interface ToolResponseWithApproval extends ToolResponse {
  approvalCreated?: boolean;
  approvalId?: string;
}

export function errorResponse(error: string): ToolResponse {
  return { success: false, response: '', error };
}

export function successResponse(response: string, usage?: ToolUsage): ToolResponse {
  return { success: true, response, usage };
}

export function handleToolError(toolName: string, error: unknown): ToolResponse {
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
    const errorWithCause = error as { cause?: { message?: string } };
    if (errorWithCause.cause?.message) {
      return errorWithCause.cause.message;
    }
  }

  const str = String(error);
  if (str && str !== '[object Object]' && str !== 'undefined') {
    return str;
  }

  return `Unknown error in ${toolName}`;
}
