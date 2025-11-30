/**
 * LLM Tools Registry
 *
 * Central registry for all LLM tools.
 * Array-based registry for type inference, with derived object for O(1) lookups.
 */

import type { ToolDefinition } from './types';
import { customerSearchTool } from './convex_tools/customers/customer_search';
import { listCustomersTool } from './convex_tools/customers/list_customers';
import { updateCustomerTool } from './convex_tools/customers/update_customer';
import {
  productGetTool,
  productSearchAliasTool,
} from './convex_tools/products/product_get';
import { listProductsTool } from './convex_tools/products/list_products';
import { updateProductTool } from './convex_tools/products/update_product';
import { findUnprocessedEntitiesTool } from './convex_tools/workflow_processing_records/find_unprocessed_entities';
import { findUnprocessedOpenConversationTool } from './convex_tools/workflow_processing_records/find_unprocessed_open_conversation';
import { markEntityProcessedTool } from './convex_tools/workflow_processing_records/mark_entity_processed';
import { ragSearchTool } from './convex_tools/rag/rag_search';
import { ragKnowledgeTool } from './convex_tools/rag/rag_knowledge';
import { fetchUrlTool } from './convex_tools/crawler/fetch_url';
import { webSearchTool } from './convex_tools/crawler/web_search';
import { getWorkflowStructureTool } from './convex_tools/workflows/get_workflow_structure';
import { updateWorkflowStepTool } from './convex_tools/workflows/update_workflow_step';
import { generateWorkflowFromDescriptionTool } from './convex_tools/workflows/generate_workflow_from_description';
import { listAvailableActionsTool } from './convex_tools/workflows/list_available_actions';
import { searchWorkflowExamplesTool } from './convex_tools/workflows/search_workflow_examples';
import { saveWorkflowDefinitionTool } from './convex_tools/workflows/save_workflow_definition';
import { validateWorkflowDefinitionTool } from './convex_tools/workflows/validate_workflow_definition';
import { generateExcelTool } from './convex_tools/files/generate_excel';
import { generateFileTool } from './convex_tools/files/generate_file';
import { contextSearchTool } from './convex_tools/threads/context_search';

/**
 * Central list of tool names used for the ToolName union type.
 *
 * Keeping this separate from TOOL_REGISTRY avoids circular type references
 * while still giving us a precise string literal union for ToolName.
 */
export const TOOL_NAMES = [
  'customer_search',
  'list_customers',
  'update_customer',
  'product_get',
  'product_search_alias',
  'list_products',
  'update_product',
  'find_unprocessed_entities',
  'find_unprocessed_open_conversation',
  'mark_entity_processed',
  'rag_search',
  'rag_knowledge',
  'fetch_url',
  'web_search',
  'generate_file',
  'get_workflow_structure',
  'update_workflow_step',
  'generate_workflow_from_description',
  'list_available_actions',
  'search_workflow_examples',
  'save_workflow_definition',
  'validate_workflow_definition',
  'generate_excel',
  'context_search',
] as const;

/**
 * Tool registry as array - enables TypeScript to infer tool names
 */
export const TOOL_REGISTRY = [
  customerSearchTool,
  listCustomersTool,
  updateCustomerTool,
  productGetTool,
  productSearchAliasTool,
  listProductsTool,
  updateProductTool,
  findUnprocessedEntitiesTool,
  findUnprocessedOpenConversationTool,
  markEntityProcessedTool,
  ragSearchTool,
  ragKnowledgeTool,
  fetchUrlTool,
  webSearchTool,
  getWorkflowStructureTool,
  updateWorkflowStepTool,
  generateWorkflowFromDescriptionTool,
  listAvailableActionsTool,
  searchWorkflowExamplesTool,
  saveWorkflowDefinitionTool,
  validateWorkflowDefinitionTool,
  generateExcelTool,
  generateFileTool,
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
