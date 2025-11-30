/**
 * Build full prompt combining system and user prompts with tool context
 */

import type {
  NormalizedConfig,
  ProcessedPrompts,
  LoadedTools,
} from './types';

export function buildFullPrompt(
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  tools: LoadedTools,
): string {
  const parts: string[] = [];

  // Add system prompt
  if (prompts.systemPrompt) {
    parts.push(`SYSTEM INSTRUCTIONS:\n${prompts.systemPrompt}`);
  }

  // Add tool information if available
  if (tools.totalCount > 0) {
    const toolInfo = [];
    
    if (tools.convexTools.length > 0) {
      toolInfo.push(`Convex Tools: ${tools.convexTools.length} available`);
    }
    
    if (Object.keys(tools.mcpTools).length > 0) {
      toolInfo.push(`MCP Tools: ${Object.keys(tools.mcpTools).length} available`);
    }
    
    parts.push(`AVAILABLE TOOLS:\n${toolInfo.join(', ')}`);
  }

  // Add output format instructions
  if (config.outputFormat === 'json') {
    parts.push('OUTPUT FORMAT: Return your response as valid JSON only, no additional text or formatting.');
  }

  // Add user prompt
  if (prompts.userPrompt) {
    parts.push(`USER REQUEST:\n${prompts.userPrompt}`);
  }

  return parts.join('\n\n');
}
