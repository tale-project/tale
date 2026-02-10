/**
 * LLM Tools Registry
 *
 * Central registry for all LLM tools.
 * Array-based registry for type inference, with derived object for O(1) lookups.
 */

import type { ToolName } from './tool_names';
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
import { webTool } from './web/web_tool';
import { createWorkflowTool } from './workflows/create_workflow_tool';
import { saveWorkflowDefinitionTool } from './workflows/save_workflow_definition_tool';
import { updateWorkflowStepTool } from './workflows/update_workflow_step_tool';
import { workflowExamplesTool } from './workflows/workflow_examples_tool';
import { workflowReadTool } from './workflows/workflow_read_tool';

// Re-export from leaf module so existing consumers don't need to change imports
export { TOOL_NAMES, type ToolName } from './tool_names';

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
 * Derived object for O(1) lookups by tool name.
 * Lazily computed to avoid circular dependency issues at module init time.
 */
let _toolRegistryMap: Record<ToolName, ToolDefinition> | null = null;

export function getToolRegistryMap(): Record<ToolName, ToolDefinition> {
  if (!_toolRegistryMap) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.fromEntries loses key type
    _toolRegistryMap = Object.fromEntries(
      TOOL_REGISTRY.map((tool: ToolDefinition) => [tool.name, tool]),
    ) as Record<ToolName, ToolDefinition>;
  }
  return _toolRegistryMap;
}
