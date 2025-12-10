/**
 * LLM Tools Registry
 *
 * Central registry for all LLM tools.
 * Array-based registry for type inference, with derived object for O(1) lookups.
 */

import type { ToolDefinition } from './types';
import { customerReadTool } from './convex_tools/customers/customer_read_tool';
import { productReadTool } from './convex_tools/products/product_read_tool';
import { ragSearchTool } from './convex_tools/rag/rag_search_tool';
import { ragWriteTool } from './convex_tools/rag/rag_write_tool';
import { webReadTool } from './convex_tools/crawler/web_read_tool';
import { workflowReadTool } from './convex_tools/workflows/workflow_read_tool';
import { updateWorkflowStepTool } from './convex_tools/workflows/update_workflow_step_tool';
import { generateWorkflowFromDescriptionTool } from './convex_tools/workflows/generate_workflow_from_description_tool';
import { saveWorkflowDefinitionTool } from './convex_tools/workflows/save_workflow_definition_tool';
import { validateWorkflowDefinitionTool } from './convex_tools/workflows/validate_workflow_definition_tool';
import { generateExcelTool } from './convex_tools/files/generate_excel_tool';
import { generateFileTool } from './convex_tools/files/generate_file_tool';
import { pptxTool } from './convex_tools/files/pptx_tool';
import { generateDocxTool } from './convex_tools/files/generate_docx_tool';
import { resourceCheckTool } from './convex_tools/files/resource_check_tool';
import { contextSearchTool } from './convex_tools/threads/context_search_tool';

/**
 * Central list of tool names used for the ToolName union type.
 *
 * Keeping this separate from TOOL_REGISTRY avoids circular type references
 * while still giving us a precise string literal union for ToolName.
 */
export const TOOL_NAMES = [
  'customer_read',
  'product_read',
  'rag_search',
  'rag_write',
  'web_read',
  'generate_file',
  'pptx',
  'generate_docx',
  'resource_check',
  'workflow_read',
  'update_workflow_step',
  'generate_workflow_from_description',
  'save_workflow_definition',
  'validate_workflow_definition',
  'generate_excel',
  'context_search',
] as const;

/**
 * Tool registry as array - enables TypeScript to infer tool names
 */
export const TOOL_REGISTRY = [
  customerReadTool,
  productReadTool,
  ragSearchTool,
  ragWriteTool,
  webReadTool,
  workflowReadTool,
  updateWorkflowStepTool,
  generateWorkflowFromDescriptionTool,
  saveWorkflowDefinitionTool,
  validateWorkflowDefinitionTool,
  generateExcelTool,
  generateFileTool,
  pptxTool,
  generateDocxTool,
  resourceCheckTool,
  contextSearchTool,
] as const;

/**
 * Type representing all valid tool names in the registry
 */
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Derived object for O(1) lookups by tool name
 */
export const TOOL_REGISTRY_MAP: Record<ToolName, ToolDefinition> =
  Object.fromEntries(
    TOOL_REGISTRY.map((tool: ToolDefinition) => [tool.name, tool]),
  ) as Record<ToolName, ToolDefinition>;
