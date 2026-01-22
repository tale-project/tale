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
  console.error(`[${toolName}] Error:`, error);
  return errorResponse(error instanceof Error ? error.message : 'Unknown error');
}
