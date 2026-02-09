/**
 * LLM Tools Registry
 *
 * Central registry for all LLM tools.
 * Array-based registry for type inference, with derived object for O(1) lookups.
 */

import type { ToolDefinition } from './types';

import { customerReadTool } from './customers/customer_read_tool';
import { databaseSchemaTool } from './database/database_schema_tool';
import { docxTool } from './files/docx_tool';
import { generateExcelTool } from './files/generate_excel_tool';
import { imageTool } from './files/image_tool';
import { pdfTool } from './files/pdf_tool';
import { pptxTool } from './files/pptx_tool';
import { resourceCheckTool } from './files/resource_check_tool';
import { txtTool } from './files/txt_tool';
import { requestHumanInputTool } from './human_input/request_human_input_tool';
import { integrationBatchTool } from './integrations/integration_batch_tool';
import { integrationIntrospectTool } from './integrations/integration_introspect_tool';
import { integrationTool } from './integrations/integration_tool';
import { verifyApprovalTool } from './integrations/verify_approval_tool';
import { productReadTool } from './products/product_read_tool';
import { ragSearchTool } from './rag/rag_search_tool';
import { crmAssistantTool } from './sub_agents/crm_assistant_tool';
import { documentAssistantTool } from './sub_agents/document_assistant_tool';
import { integrationAssistantTool } from './sub_agents/integration_assistant_tool';
import { webAssistantTool } from './sub_agents/web_assistant_tool';
import { workflowAssistantTool } from './sub_agents/workflow_assistant_tool';
import { contextSearchTool } from './threads/context_search_tool';
import { webTool } from './web/web_tool';
import { createWorkflowTool } from './workflows/create_workflow_tool';
import { saveWorkflowDefinitionTool } from './workflows/save_workflow_definition_tool';
import { updateWorkflowStepTool } from './workflows/update_workflow_step_tool';
import { workflowExamplesTool } from './workflows/workflow_examples_tool';
import { workflowReadTool } from './workflows/workflow_read_tool';

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
  'web',
  'pdf',
  'image',
  'pptx',
  'docx',
  'txt',
  'resource_check',
  'workflow_read',
  'workflow_examples',
  'update_workflow_step',
  'save_workflow_definition',
  'create_workflow',
  'generate_excel',
  'context_search',
  'integration',
  'integration_batch',
  'integration_introspect',
  'verify_approval',
  'database_schema',
  'workflow_assistant',
  'web_assistant',
  'document_assistant',
  'integration_assistant',
  'crm_assistant',
  'request_human_input',
] as const;

/**
 * Tool registry as array - enables TypeScript to infer tool names
 */
export const TOOL_REGISTRY = [
  customerReadTool,
  productReadTool,
  ragSearchTool,
  webTool,
  workflowReadTool,
  workflowExamplesTool,
  updateWorkflowStepTool,
  saveWorkflowDefinitionTool,
  createWorkflowTool,
  generateExcelTool,
  pdfTool,
  imageTool,
  pptxTool,
  docxTool,
  txtTool,
  resourceCheckTool,
  contextSearchTool,
  integrationTool,
  integrationBatchTool,
  integrationIntrospectTool,
  verifyApprovalTool,
  databaseSchemaTool,
  workflowAssistantTool,
  webAssistantTool,
  documentAssistantTool,
  integrationAssistantTool,
  crmAssistantTool,
  requestHumanInputTool,
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
